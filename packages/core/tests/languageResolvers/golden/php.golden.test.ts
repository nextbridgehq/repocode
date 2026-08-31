import { describe, it, expect } from 'vitest';
import { traceFixture } from './goldenHelper.js';

const ENTRY = 'src/Entry.php';

describe('php import graph (golden)', () => {
  it('depth 1: direct dependency and direct importer only', async () => {
    expect(await traceFixture('php', ENTRY, 1)).toEqual({
      dependencies: ['src/Mid.php'],
      importers: ['src/Importer.php'],
    });
  });

  it('depth 2: reaches the transitive dependency and the transitive importer', async () => {
    expect(await traceFixture('php', ENTRY, 2)).toEqual({
      dependencies: ['src/Leaf.php', 'src/Mid.php'],
      importers: ['src/Importer.php', 'src/Importer2.php'],
    });
  });

  it('depth 3: unchanged from depth 2 — the BFS stops at the true edge of the graph', async () => {
    expect(await traceFixture('php', ENTRY, 3)).toEqual({
      dependencies: ['src/Leaf.php', 'src/Mid.php'],
      importers: ['src/Importer.php', 'src/Importer2.php'],
    });
  });
});
