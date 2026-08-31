import { describe, it, expect } from 'vitest';
import { traceHardCase } from '../golden/goldenHelper.js';

const ENTRY = 'pkg/entry.py';

// One leading dot means "the current package" — the directory holding the importing file.
// Each extra dot moves one level up. pkg/sub/child.py's `from ..mid import` therefore
// resolves to pkg/mid.py, which is why it shows up as an importer at depth 2.
describe('python relative imports (hard case)', () => {
  it('depth 1: resolves a single-dot relative import', async () => {
    expect(await traceHardCase('python-relative', ENTRY, 1)).toEqual({
      dependencies: ['pkg/mid.py'],
      importers: [],
    });
  });

  it('depth 2: follows the relative chain and finds the two-dot importer', async () => {
    expect(await traceHardCase('python-relative', ENTRY, 2)).toEqual({
      dependencies: ['pkg/leaf.py', 'pkg/mid.py'],
      importers: ['pkg/sub/child.py'],
    });
  });

  it('depth 3: unchanged from depth 2 — the BFS stops at the true edge of the graph', async () => {
    expect(await traceHardCase('python-relative', ENTRY, 3)).toEqual({
      dependencies: ['pkg/leaf.py', 'pkg/mid.py'],
      importers: ['pkg/sub/child.py'],
    });
  });

  it('resolves a two-dot parent-package import when seeded at the child', async () => {
    expect(await traceHardCase('python-relative', 'pkg/sub/child.py', 1)).toEqual({
      dependencies: ['pkg/mid.py'],
      importers: [],
    });
  });
});
