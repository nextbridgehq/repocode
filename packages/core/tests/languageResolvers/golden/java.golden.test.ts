import { describe, it, expect } from 'vitest';
import { traceFixture } from './goldenHelper.js';

const ENTRY = 'src/main/java/com/example/Entry.java';
const BASE = 'src/main/java/com/example';

describe('java import graph (golden)', () => {
  it('depth 1: direct dependency and direct importer only', async () => {
    expect(await traceFixture('java', ENTRY, 1)).toEqual({
      dependencies: [`${BASE}/Mid.java`],
      importers: [`${BASE}/Importer.java`],
    });
  });

  it('depth 2: reaches the transitive dependency and the transitive importer', async () => {
    expect(await traceFixture('java', ENTRY, 2)).toEqual({
      dependencies: [`${BASE}/Leaf.java`, `${BASE}/Mid.java`],
      importers: [`${BASE}/Importer.java`, `${BASE}/Importer2.java`],
    });
  });

  it('depth 3: unchanged from depth 2 — the BFS stops at the true edge of the graph', async () => {
    expect(await traceFixture('java', ENTRY, 3)).toEqual({
      dependencies: [`${BASE}/Leaf.java`, `${BASE}/Mid.java`],
      importers: [`${BASE}/Importer.java`, `${BASE}/Importer2.java`],
    });
  });
});
