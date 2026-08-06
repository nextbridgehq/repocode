import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runPipeline, DEFAULT_CONFIG } from '../src/index.js';
// buildGraph is internal (not re-exported from index.ts) — imported directly.
import { buildGraph } from '../src/ranking/graphBuilder.js';

let tmpDir: string;

function makeTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-edge-'));
  return tmpDir;
}

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function baseConfig(root: string) {
  return {
    ...DEFAULT_CONFIG,
    root,
    output: { ...DEFAULT_CONFIG.output, stdout: true },
    verbose: false,
    dryRun: false,
  };
}

describe('edge cases', () => {
  it('empty repo: runPipeline returns included:[] and excluded:[]', async () => {
    const root = makeTmpDir();
    const result = await runPipeline(baseConfig(root));
    expect(result.included).toEqual([]);
    expect(result.excluded).toEqual([]);
  });

  it('binary-only repo: all files in excluded with reason "binary"', async () => {
    const root = makeTmpDir();
    // Write a binary file (PNG magic bytes)
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    fs.writeFileSync(path.join(root, 'image.png'), pngBytes);

    const result = await runPipeline(baseConfig(root));
    expect(result.included).toEqual([]);
    expect(result.excluded.length).toBeGreaterThan(0);
    expect(result.excluded.every(e => e.reason === 'binary')).toBe(true);
  });

  it('file larger than budget is excluded with reason "exceeds-budget"', async () => {
    const root = makeTmpDir();
    // Write a file with ~2000 chars which is ~500 tokens.
    // Budget: maxTokens=400 (no reserves).
    //   overhead ≈ 55 tokens (50 metadata + 5 tree for 1 candidate; empty headerText)
    //   effectiveBudget ≈ 345, which is below the file's ~500 tokens
    //   selectCandidates: candidateCount=floor((345/504)*3)=2, capped at 1 file → 1 candidate
    //   fitToBudget: ~500 tokens > 345 effectiveBudget → excluded with 'exceeds-budget'
    fs.writeFileSync(path.join(root, 'big.ts'), 'export const x = ' + 'a'.repeat(2000) + ';');

    const result = await runPipeline({
      ...baseConfig(root),
      budget: { maxTokens: 400, reserveForResponse: 0, reserveForPrompt: 0 },
    });
    const bigFile = result.excluded.find(e => e.path === 'big.ts');
    expect(bigFile).toBeDefined();
    expect(bigFile?.reason).toMatch(/exceeds-budget/);
  });

  it('circular import graph: buildGraph completes without hanging', async () => {
    const root = makeTmpDir();
    // Create A → B → A circular import
    fs.writeFileSync(path.join(root, 'a.ts'), "import './b.js';");
    fs.writeFileSync(path.join(root, 'b.ts'), "import './a.js';");

    // Should complete within a reasonable time (test runner timeout catches hangs)
    const result = await buildGraph(root, DEFAULT_CONFIG.ignore);
    expect(result).toBeDefined();
    expect(result.centralityMap).toBeDefined();
  });
});
