import { describe, it, expect } from 'vitest';
import { traceFixture } from './goldenHelper.js';

const ENTRY = 'src/entry.rs';

describe('rust import graph (golden)', () => {
  it('depth 1: direct dependency and direct importer only', async () => {
    expect(await traceFixture('rust', ENTRY, 1)).toEqual({
      dependencies: ['src/mid.rs'],
      importers: ['src/importer.rs'],
    });
  });

  it('depth 2: reaches the transitive dependency and the transitive importer', async () => {
    expect(await traceFixture('rust', ENTRY, 2)).toEqual({
      dependencies: ['src/leaf.rs', 'src/mid.rs'],
      importers: ['src/importer.rs', 'src/importer2.rs'],
    });
  });

  it('depth 3: unchanged from depth 2 — the BFS stops at the true edge of the graph', async () => {
    expect(await traceFixture('rust', ENTRY, 3)).toEqual({
      dependencies: ['src/leaf.rs', 'src/mid.rs'],
      importers: ['src/importer.rs', 'src/importer2.rs'],
    });
  });
});
