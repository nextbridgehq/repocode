import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runPipeline } from '../../src/pipeline.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import type { RepoCodeConfig } from '../../src/types.js';

function body(tag: string, lines: number): string {
  return Array.from(
    { length: lines },
    (_, l) => `export function ${tag}_${l}(a: number): number { return a + ${l}; }`,
  ).join('\n');
}

/** A repo shaped like the failure seen on real projects: small shallow leaves that rank high
 *  on pass 1, plus large deep "core" modules that rank low on pass 1 but are imported by
 *  everything, so pass 2 lifts them on centrality. The cores fall outside a small budget's
 *  candidate cut and inside a large one's — which is what lets a bigger budget reshuffle the
 *  order rather than merely extend it. */
function writeRepo(root: string): void {
  const CORES = 8;
  for (let c = 0; c < CORES; c++) {
    const dir = path.join(root, 'src', 'internal', 'core');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `core${c}.ts`), body(`core${c}`, 120));
  }

  for (let i = 0; i < 60; i++) {
    const dir = path.join(root, `mod${i % 6}`);
    fs.mkdirSync(dir, { recursive: true });
    const imports = Array.from(
      { length: CORES },
      (_, c) => `import { core${c}_0 } from '../src/internal/core/core${c}.js';`,
    ).join('\n');
    const lines = 5 + ((i * 37) % 90);
    fs.writeFileSync(path.join(dir, `file${i}.ts`), `${imports}\n${body(`fn${i}`, lines)}`);
  }
}

describe('budget monotonicity', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-monotonic-'));
    writeRepo(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function configFor(maxTokens: number): RepoCodeConfig {
    return {
      ...DEFAULT_CONFIG,
      root: tmpDir,
      output: { ...DEFAULT_CONFIG.output, format: 'json', preamble: false },
      budget: { maxTokens, reserveForResponse: 0, reserveForPrompt: 0 },
      security: { enabled: false, mode: 'warn' },
    };
  }

  it('a larger budget includes every file a smaller budget included', async () => {
    const small = await runPipeline(configFor(8_000));
    const large = await runPipeline(configFor(16_000));

    const smallPaths = small.included.map(f => f.path);
    const largePaths = new Set(large.included.map(f => f.path));

    // Guards: the budget has to actually bind for this to test anything.
    expect(smallPaths.length).toBeGreaterThan(5);
    expect(smallPaths.length).toBeLessThan(60);

    expect(smallPaths.filter(p => !largePaths.has(p))).toEqual([]);
    expect(large.included.length).toBeGreaterThan(smallPaths.length);
  });
});

/** Functions with long bodies, so stripping bodies is a large saving — the shape that makes
 *  the gap between a whole file and its signature big enough to matter. */
function fatBody(tag: string, fns: number, bodyLines: number): string {
  return Array.from({ length: fns }, (_, i) =>
    `export function ${tag}_${i}(a: number): number {\n`
    + Array.from({ length: bodyLines }, (_, l) => `  const v${l} = a * ${l} + ${i};`).join('\n')
    + '\n  return a;\n}',
  ).join('\n\n');
}

/** A handful of very large, heavily imported modules alongside many small ones. Centrality
 *  ranks the large ones early; at a small budget they only fit compressed, at a larger one
 *  they fit whole, and the extra tokens they swallow can exceed the budget increase and
 *  starve everything ranked after them. */
function writeLopsidedRepo(root: string): void {
  const dir = path.join(root, 'big');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(dir, `huge${i}.ts`), fatBody(`huge${i}`, 25, 40));
  }
  const smallDir = path.join(root, 'small');
  fs.mkdirSync(smallDir, { recursive: true });
  const imports = Array.from(
    { length: 3 },
    (_, i) => `import { huge${i}_0 } from '../big/huge${i}.js';`,
  ).join('\n');
  for (let i = 0; i < 40; i++) {
    fs.writeFileSync(path.join(smallDir, `s${i}.ts`), `${imports}\n${body(`s${i}`, 8)}`);
  }
}

describe('budget monotonicity across compression tiers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-monotonic-tier-'));
    writeLopsidedRepo(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function configFor(maxTokens: number): RepoCodeConfig {
    return {
      ...DEFAULT_CONFIG,
      root: tmpDir,
      output: { ...DEFAULT_CONFIG.output, format: 'json', preamble: false },
      budget: { maxTokens, reserveForResponse: 0, reserveForPrompt: 0 },
      security: { enabled: false, mode: 'warn' },
    };
  }

  it('a file entering uncompressed at a larger budget does not evict the tail', async () => {
    // 12k fits the large modules only as tier-2 signatures (~366 tokens each); 25k fits one
    // whole (~6.9k), an 18x jump that has to come out of some other file's share.
    const small = await runPipeline(configFor(12_000));
    const large = await runPipeline(configFor(25_000));

    const smallPaths = small.included.map(f => f.path);
    const largePaths = new Set(large.included.map(f => f.path));

    expect(smallPaths.length).toBeGreaterThan(5);
    expect(smallPaths.filter(p => !largePaths.has(p))).toEqual([]);
  });
});
