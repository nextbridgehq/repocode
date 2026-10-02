import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir: string;

function write(rel: string, content: string): void {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

const IGNORE_NOTHING = {
  useGitignore: false,
  useDefaultPatterns: false,
  customPatterns: [],
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-graph-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('buildGraph', () => {
  it('builds adjacency list: A imports B → A has edge to B', async () => {
    write('a.ts', `import { b } from './b.js'; export const a = b;`);
    write('b.ts', `export const b = 1;`);
    const { buildGraph } = await import('../../src/ranking/graphBuilder.js');
    const { imports } = await buildGraph(tmpDir, IGNORE_NOTHING);
    expect(imports['a.ts']).toContain('b.ts');
  });

  it('computes in-degree: b.ts imported by a.ts and c.ts → centrality of b.ts > centrality of a.ts', async () => {
    write('a.ts', `import { b } from './b.js';`);
    write('b.ts', `export const b = 1;`);
    write('c.ts', `import { b } from './b.js';`);
    const { buildGraph } = await import('../../src/ranking/graphBuilder.js');
    const { centralityMap } = await buildGraph(tmpDir, IGNORE_NOTHING);
    const bAbs = path.join(tmpDir, 'b.ts');
    const aAbs = path.join(tmpDir, 'a.ts');
    expect(centralityMap.get(bAbs)!).toBeGreaterThan(centralityMap.get(aAbs) ?? 0);
  });

  it('higher in-degree → higher centrality score', async () => {
    write('hub.ts', `export const hub = 1;`);
    write('leaf.ts', `export const leaf = 2;`);
    write('i1.ts', `import { hub } from './hub.js';`);
    write('i2.ts', `import { hub } from './hub.js';`);
    write('i3.ts', `import { hub } from './hub.js';`);
    const { buildGraph } = await import('../../src/ranking/graphBuilder.js');
    const { centralityMap } = await buildGraph(tmpDir, IGNORE_NOTHING);
    const hubAbs = path.join(tmpDir, 'hub.ts');
    const leafAbs = path.join(tmpDir, 'leaf.ts');
    expect(centralityMap.get(hubAbs)!).toBeGreaterThan(centralityMap.get(leafAbs) ?? 0);
  });

  it('all centrality scores are in [0, 1]', async () => {
    write('a.ts', `import { b } from './b.js';`);
    write('b.ts', `import { c } from './c.js';`);
    write('c.ts', `export const c = 1;`);
    const { buildGraph } = await import('../../src/ranking/graphBuilder.js');
    const { centralityMap } = await buildGraph(tmpDir, IGNORE_NOTHING);
    for (const score of centralityMap.values()) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('file with in-degree 0 gets centrality 0', async () => {
    write('a.ts', `export const a = 1;`);
    write('b.ts', `export const b = 2;`);
    write('c.ts', `import { b } from './b.js';`);
    const { buildGraph } = await import('../../src/ranking/graphBuilder.js');
    const { centralityMap } = await buildGraph(tmpDir, IGNORE_NOTHING);
    const aAbs = path.join(tmpDir, 'a.ts');
    expect(centralityMap.get(aAbs)).toBe(0);
  });

  it('cache written to .repocode/cache.json after first build', async () => {
    write('a.ts', `export const a = 1;`);
    const { buildGraph } = await import('../../src/ranking/graphBuilder.js');
    await buildGraph(tmpDir, IGNORE_NOTHING);
    const cachePath = path.join(tmpDir, '.repocode', 'cache.json');
    expect(fs.existsSync(cachePath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    expect(parsed.version).toBe(3);
    expect(parsed.files['a.ts'].imports).toEqual([]);
  });

  it('cache hit: unchanged file keeps the same cached hash across builds', async () => {
    write('a.ts', `import { b } from './b.js';`);
    write('b.ts', `export const b = 1;`);
    const { buildGraph } = await import('../../src/ranking/graphBuilder.js');
    await buildGraph(tmpDir, IGNORE_NOTHING);
    const cachePath = path.join(tmpDir, '.repocode', 'cache.json');
    const firstHash = JSON.parse(fs.readFileSync(cachePath, 'utf-8')).files['a.ts'].hash;

    await buildGraph(tmpDir, IGNORE_NOTHING);
    const secondHash = JSON.parse(fs.readFileSync(cachePath, 'utf-8')).files['a.ts'].hash;
    expect(secondHash).toBe(firstHash);
  });

  it('cache miss: changing one file leaves other files\' cache entries untouched', async () => {
    write('a.ts', `export const a = 1;`);
    write('b.ts', `export const b = 1;`);
    const { buildGraph } = await import('../../src/ranking/graphBuilder.js');
    await buildGraph(tmpDir, IGNORE_NOTHING);
    const cachePath = path.join(tmpDir, '.repocode', 'cache.json');
    const bHashBefore = JSON.parse(fs.readFileSync(cachePath, 'utf-8')).files['b.ts'].hash;

    write('a.ts', `import { b } from './b.js'; export const a = b;`);
    const { imports } = await buildGraph(tmpDir, IGNORE_NOTHING);
    expect(imports['a.ts']).toContain('b.ts');
    const bHashAfter = JSON.parse(fs.readFileSync(cachePath, 'utf-8')).files['b.ts'].hash;
    expect(bHashAfter).toBe(bHashBefore);
  });

  it('node_modules import targets are excluded from adjacency list', async () => {
    write('a.ts', `import { readFile } from 'fs'; import lodash from 'lodash'; export const a = 1;`);
    const { buildGraph } = await import('../../src/ranking/graphBuilder.js');
    const { imports } = await buildGraph(tmpDir, IGNORE_NOTHING);
    expect(imports['a.ts'] ?? []).not.toContain('fs');
    expect(imports['a.ts'] ?? []).not.toContain('lodash');
  });

  it('bare specifiers are excluded: only relative imports resolving to local files appear', async () => {
    write('a.ts', `import express from 'express'; import { foo } from './foo.js'; export const a = 1;`);
    write('foo.ts', `export const foo = 1;`);
    const { buildGraph } = await import('../../src/ranking/graphBuilder.js');
    const { imports } = await buildGraph(tmpDir, IGNORE_NOTHING);
    expect(imports['a.ts']).toContain('foo.ts');
    expect(imports['a.ts'].every((imp: string) => !imp.includes('express'))).toBe(true);
  });

  it('does not scan node_modules nested under a subdirectory (monorepo shape) when default patterns are on', async () => {
    write('packages/core/src/a.ts', `export const a = 1;`);
    write('packages/core/node_modules/some-dep/index.ts', `export const dep = 1;`);
    const { buildGraph } = await import('../../src/ranking/graphBuilder.js');
    const t0 = Date.now();
    const { imports } = await buildGraph(tmpDir, {
      useGitignore: false,
      useDefaultPatterns: true,
      customPatterns: [],
    });
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(Object.keys(imports)).toEqual(['packages/core/src/a.ts']);
  });
});
