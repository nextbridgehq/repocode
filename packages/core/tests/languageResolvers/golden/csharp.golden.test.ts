import { describe, it, expect } from 'vitest';
import { traceFixture } from './goldenHelper.js';

const ENTRY = 'App/Entry/Entry.cs';

describe('csharp import graph (golden)', () => {
  it('depth 1: direct dependency and direct importer only', async () => {
    expect(await traceFixture('csharp', ENTRY, 1)).toEqual({
      dependencies: ['App/Mid/Mid.cs'],
      importers: ['App/Importer/Importer.cs'],
    });
  });

  it('depth 2: reaches the transitive dependency and the transitive importer', async () => {
    expect(await traceFixture('csharp', ENTRY, 2)).toEqual({
      dependencies: ['App/Leaf/Leaf.cs', 'App/Mid/Mid.cs'],
      importers: ['App/Importer/Importer.cs', 'App/Importer2/Importer2.cs'],
    });
  });

  it('depth 3: unchanged from depth 2 — the BFS stops at the true edge of the graph', async () => {
    expect(await traceFixture('csharp', ENTRY, 3)).toEqual({
      dependencies: ['App/Leaf/Leaf.cs', 'App/Mid/Mid.cs'],
      importers: ['App/Importer/Importer.cs', 'App/Importer2/Importer2.cs'],
    });
  });
});
