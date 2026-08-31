import { describe, it, expect } from 'vitest';
import { traceFixture } from './goldenHelper.js';

const ENTRY = 'src/entry.ts';

describe('typescript import graph (golden)', () => {
  it('depth 1: direct dependency and direct importer only', async () => {
    expect(await traceFixture('typescript', ENTRY, 1)).toEqual({
      dependencies: ['src/mid.ts'],
      importers: ['src/importer.ts'],
    });
  });

  it('depth 2: reaches the transitive dependency and the transitive importer', async () => {
    expect(await traceFixture('typescript', ENTRY, 2)).toEqual({
      dependencies: ['src/leaf.ts', 'src/mid.ts'],
      importers: ['src/importer.ts', 'src/importer2.ts'],
    });
  });

  it('depth 3: unchanged from depth 2 — the BFS stops at the true edge of the graph', async () => {
    expect(await traceFixture('typescript', ENTRY, 3)).toEqual({
      dependencies: ['src/leaf.ts', 'src/mid.ts'],
      importers: ['src/importer.ts', 'src/importer2.ts'],
    });
  });
});
