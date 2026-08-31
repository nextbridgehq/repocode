import { describe, it, expect } from 'vitest';
import { traceFixture } from './goldenHelper.js';

const ENTRY = 'internal/entry/entry.go';

// Go resolves an import to a package DIRECTORY rather than a single file. The tracer
// expands that directory into its own source files (see expandPackageDirectory in
// importTracer.ts), so Go now reaches its transitive dependency and both importers by
// depth 2, matching every other language in this directory.
describe('go import graph (golden)', () => {
  it('depth 1: direct dependency and direct importer only', async () => {
    expect(await traceFixture('go', ENTRY, 1)).toEqual({
      dependencies: ['internal/mid/mid.go'],
      importers: ['internal/importer/importer.go'],
    });
  });

  it('depth 2: reaches the transitive dependency and the transitive importer', async () => {
    expect(await traceFixture('go', ENTRY, 2)).toEqual({
      dependencies: ['internal/leaf/leaf.go', 'internal/mid/mid.go'],
      importers: ['internal/importer/importer.go', 'internal/importer2/importer2.go'],
    });
  });

  it('depth 3: unchanged from depth 2 — the BFS stops at the true edge of the graph', async () => {
    expect(await traceFixture('go', ENTRY, 3)).toEqual({
      dependencies: ['internal/leaf/leaf.go', 'internal/mid/mid.go'],
      importers: ['internal/importer/importer.go', 'internal/importer2/importer2.go'],
    });
  });
});
