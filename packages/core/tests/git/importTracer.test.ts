import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-trace-'));

  // A changed file that imports b.ts and is imported by c.ts
  fs.writeFileSync(path.join(tmpDir, 'a.ts'), `
import { b } from './b.js';
export const a = b + 1;
`.trim());

  // A dependency of a.ts
  fs.writeFileSync(path.join(tmpDir, 'b.ts'), `
export const b = 42;
`.trim());

  // An importer of a.ts
  fs.writeFileSync(path.join(tmpDir, 'c.ts'), `
import { a } from './a.js';
export const c = a * 2;
`.trim());

  // An unrelated file
  fs.writeFileSync(path.join(tmpDir, 'unrelated.ts'), `
export const x = 0;
`.trim());

  // Python file that imports a module
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'main.py'), `
from src.utils import helper
import os
`.trim());
  fs.writeFileSync(path.join(tmpDir, 'src', 'utils.py'), `
def helper(): pass
`.trim());
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('traceImports', () => {
  it('finds dependencies: what a.ts imports', async () => {
    const { traceImports } = await import('../../src/git/importTracer.js');
    const result = await traceImports(['a.ts'], tmpDir, () => false);
    expect(result.dependencies).toContain('b.ts');
    expect(result.dependencies).not.toContain('a.ts'); // not self
    expect(result.dependencies).not.toContain('c.ts'); // c imports a, not the reverse
  });

  it('finds importers: what imports a.ts', async () => {
    const { traceImports } = await import('../../src/git/importTracer.js');
    const result = await traceImports(['a.ts'], tmpDir, () => false);
    expect(result.importers).toContain('c.ts');
    expect(result.importers).not.toContain('unrelated.ts');
    expect(result.importers).not.toContain('a.ts'); // not self
  });

  it('does not return already-changed files as importers or deps', async () => {
    const { traceImports } = await import('../../src/git/importTracer.js');
    // Both a.ts and b.ts are changed
    const result = await traceImports(['a.ts', 'b.ts'], tmpDir, () => false);
    expect(result.dependencies).not.toContain('a.ts');
    expect(result.dependencies).not.toContain('b.ts');
    expect(result.importers).not.toContain('a.ts');
    expect(result.importers).not.toContain('b.ts');
  });

  it('respects the ignore filter', async () => {
    const { traceImports } = await import('../../src/git/importTracer.js');
    // Ignore c.ts — it should not appear as an importer
    const ignore = (p: string) => p === 'c.ts';
    const result = await traceImports(['a.ts'], tmpDir, ignore);
    expect(result.importers).not.toContain('c.ts');
  });

  it('returns empty arrays when changed files have no imports', async () => {
    const { traceImports } = await import('../../src/git/importTracer.js');
    const result = await traceImports(['unrelated.ts'], tmpDir, () => false);
    expect(result.dependencies).toHaveLength(0);
    // unrelated.ts is not imported by anything
    expect(result.importers).toHaveLength(0);
  });

  it('resolves Python dotted imports', async () => {
    const { traceImports } = await import('../../src/git/importTracer.js');
    const result = await traceImports(['src/main.py'], tmpDir, () => false);
    expect(result.dependencies).toContain('src/utils.py');
  });
});

describe('traceImports — depth-N BFS', () => {
  let deepDir: string;

  beforeAll(() => {
    deepDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-trace-deep-'));
    // a.ts imports b.ts imports c.ts (depth-2 dep chain from a)
    fs.writeFileSync(path.join(deepDir, 'a.ts'), `import { b } from './b.js';\nexport const a = b;`);
    fs.writeFileSync(path.join(deepDir, 'b.ts'), `import { c } from './c.js';\nexport const b = c;`);
    fs.writeFileSync(path.join(deepDir, 'c.ts'), `export const c = 1;`);
    // x.ts imports a.ts, y.ts imports x.ts (depth-2 importer chain from a)
    fs.writeFileSync(path.join(deepDir, 'x.ts'), `import { a } from './a.js';\nexport const x = a;`);
    fs.writeFileSync(path.join(deepDir, 'y.ts'), `import { x } from './x.js';\nexport const y = x;`);
    // cycle.ts imports loop.ts imports cycle.ts
    fs.writeFileSync(path.join(deepDir, 'cycle.ts'), `import { loop } from './loop.js';\nexport const cycle = loop;`);
    fs.writeFileSync(path.join(deepDir, 'loop.ts'), `import { cycle } from './cycle.js';\nexport const loop = cycle;`);
    // isolated.ts has no imports and nobody imports it
    fs.writeFileSync(path.join(deepDir, 'isolated.ts'), `export const isolated = 0;`);
  });

  afterAll(() => {
    fs.rmSync(deepDir, { recursive: true, force: true });
  });

  it('depth=2: finds transitive dependency (a→b→c: c appears when tracing from a)', async () => {
    const { traceImports } = await import('../../src/git/importTracer.js');
    const result = await traceImports(['a.ts'], deepDir, () => false, 2);
    expect(result.dependencies).toContain('b.ts'); // depth-1 dep
    expect(result.dependencies).toContain('c.ts'); // depth-2 dep
  });

  it('depth=2: finds transitive importer (y→x→a: y appears when tracing from a)', async () => {
    const { traceImports } = await import('../../src/git/importTracer.js');
    const result = await traceImports(['a.ts'], deepDir, () => false, 2);
    expect(result.importers).toContain('x.ts'); // depth-1 importer
    expect(result.importers).toContain('y.ts'); // depth-2 importer
  });

  it('cycle A→B→A does not loop; each file visited at most once', async () => {
    const { traceImports } = await import('../../src/git/importTracer.js');
    const result = await traceImports(['cycle.ts'], deepDir, () => false, 5);
    const allFound = [...result.dependencies, ...result.importers];
    const loopCount = allFound.filter(p => p === 'loop.ts').length;
    expect(loopCount).toBeLessThanOrEqual(1);
  });

  it('early termination: isolated file with depth=5 returns same result as depth=1', async () => {
    const { traceImports } = await import('../../src/git/importTracer.js');
    const r1 = await traceImports(['isolated.ts'], deepDir, () => false, 1);
    const r5 = await traceImports(['isolated.ts'], deepDir, () => false, 5);
    expect(r5.dependencies).toEqual(r1.dependencies);
    expect(r5.importers).toEqual(r1.importers);
  });

  it('depth=1 (default): only direct deps and importers found, not depth-2', async () => {
    const { traceImports } = await import('../../src/git/importTracer.js');
    const result = await traceImports(['a.ts'], deepDir, () => false, 1);
    expect(result.dependencies).toContain('b.ts');
    expect(result.dependencies).not.toContain('c.ts'); // only at depth-2
    expect(result.importers).toContain('x.ts');
    expect(result.importers).not.toContain('y.ts'); // only at depth-2
  });
});
