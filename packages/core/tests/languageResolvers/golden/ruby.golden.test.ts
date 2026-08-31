import { describe, it, expect } from 'vitest';
import { traceFixture } from './goldenHelper.js';

const ENTRY = 'entry.rb';

describe('ruby import graph (golden)', () => {
  it('depth 1: direct dependency and direct importer only', async () => {
    expect(await traceFixture('ruby', ENTRY, 1)).toEqual({
      dependencies: ['mid.rb'],
      importers: ['importer.rb'],
    });
  });

  it('depth 2: reaches the transitive dependency and the transitive importer', async () => {
    expect(await traceFixture('ruby', ENTRY, 2)).toEqual({
      dependencies: ['leaf.rb', 'mid.rb'],
      importers: ['importer.rb', 'importer2.rb'],
    });
  });

  it('depth 3: unchanged from depth 2 — the BFS stops at the true edge of the graph', async () => {
    expect(await traceFixture('ruby', ENTRY, 3)).toEqual({
      dependencies: ['leaf.rb', 'mid.rb'],
      importers: ['importer.rb', 'importer2.rb'],
    });
  });
});
