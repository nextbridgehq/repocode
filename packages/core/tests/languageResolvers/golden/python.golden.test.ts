import { describe, it, expect } from 'vitest';
import { traceFixture } from './goldenHelper.js';

const ENTRY = 'pkg/entry.py';

describe('python import graph (golden)', () => {
  it('depth 1: direct dependency and direct importer only', async () => {
    expect(await traceFixture('python', ENTRY, 1)).toEqual({
      dependencies: ['pkg/mid.py'],
      importers: ['pkg/importer.py'],
    });
  });

  it('depth 2: reaches the transitive dependency and the transitive importer', async () => {
    expect(await traceFixture('python', ENTRY, 2)).toEqual({
      dependencies: ['pkg/leaf.py', 'pkg/mid.py'],
      importers: ['pkg/importer.py', 'pkg/importer2.py'],
    });
  });

  it('depth 3: unchanged from depth 2 — the BFS stops at the true edge of the graph', async () => {
    expect(await traceFixture('python', ENTRY, 3)).toEqual({
      dependencies: ['pkg/leaf.py', 'pkg/mid.py'],
      importers: ['pkg/importer.py', 'pkg/importer2.py'],
    });
  });
});
