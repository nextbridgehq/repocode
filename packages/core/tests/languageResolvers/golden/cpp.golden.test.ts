import { describe, it, expect } from 'vitest';
import { traceFixture } from './goldenHelper.js';

const ENTRY = 'entry.h';

describe('c/c++ import graph (golden)', () => {
  it('depth 1: direct dependency and direct importer only', async () => {
    expect(await traceFixture('cpp', ENTRY, 1)).toEqual({
      dependencies: ['mid.h'],
      importers: ['importer.h'],
    });
  });

  it('depth 2: reaches the transitive dependency and the transitive importer', async () => {
    expect(await traceFixture('cpp', ENTRY, 2)).toEqual({
      dependencies: ['leaf.h', 'mid.h'],
      importers: ['importer.h', 'importer2.h'],
    });
  });

  it('depth 3: unchanged from depth 2 — the BFS stops at the true edge of the graph', async () => {
    expect(await traceFixture('cpp', ENTRY, 3)).toEqual({
      dependencies: ['leaf.h', 'mid.h'],
      importers: ['importer.h', 'importer2.h'],
    });
  });
});
