import { describe, it, expect } from 'vitest';
import {
  filterAndSort, computeDepFiles, applyToggle,
  applySelectAll, applyAddDeps, clampCursor,
} from '../../src/tui/fileListUtils.js';
import type { TUIFile } from '@repocode/core';

function makeFile(filePath: string, score: number, tokens: number): TUIFile {
  return {
    path: filePath, absolutePath: `/root/${filePath}`, size: tokens * 4,
    language: null, mtime: new Date(), isBinary: false, source: 'normal',
    score, signalScores: { structural: 0, depth: 0, size: 0, extension: 0, keyword: 0, recency: 0 },
    content: 'x'.repeat(tokens * 4), tokens,
  };
}

const files = [
  makeFile('a.ts', 0.9, 100),
  makeFile('b.ts', 0.7, 200),
  makeFile('c.ts', 0.5, 50),
];
const imports = new Map([['a.ts', ['b.ts']], ['b.ts', []]]);

describe('filterAndSort', () => {
  it('empty filter returns all files sorted by rank desc', () => {
    const result = filterAndSort(files, '', 'rank');
    expect(result.map(f => f.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('filter narrows list to substring matches', () => {
    const result = filterAndSort(files, 'b', 'rank');
    expect(result.map(f => f.path)).toEqual(['b.ts']);
  });

  it('sortBy name sorts alphabetically', () => {
    const result = filterAndSort(files, '', 'name');
    expect(result.map(f => f.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('sortBy tokens sorts by token count desc', () => {
    const result = filterAndSort(files, '', 'tokens');
    expect(result.map(f => f.path)).toEqual(['b.ts', 'a.ts', 'c.ts']);
  });
});

describe('computeDepFiles', () => {
  it('returns direct imports of cursor file', () => {
    const deps = computeDepFiles(files, 0, imports); // cursor on a.ts
    expect(deps).toEqual(new Set(['b.ts']));
  });

  it('returns empty set when cursor file has no imports', () => {
    const deps = computeDepFiles(files, 1, imports); // cursor on b.ts
    expect(deps.size).toBe(0);
  });

  it('returns empty set for out-of-bounds cursor', () => {
    const deps = computeDepFiles(files, 99, imports);
    expect(deps.size).toBe(0);
  });
});

describe('applyToggle', () => {
  it('adds path when not selected', () => {
    const result = applyToggle(new Set(), 'a.ts');
    expect(result.has('a.ts')).toBe(true);
  });

  it('removes path when already selected', () => {
    const result = applyToggle(new Set(['a.ts']), 'a.ts');
    expect(result.has('a.ts')).toBe(false);
  });

  it('returns a new Set (immutable)', () => {
    const original = new Set(['a.ts']);
    const result = applyToggle(original, 'b.ts');
    expect(result).not.toBe(original);
  });
});

describe('applySelectAll', () => {
  it('adds all visible files to existing selection', () => {
    const visible = [files[0], files[1]];
    const result = applySelectAll(new Set(['c.ts']), visible);
    expect(result).toEqual(new Set(['a.ts', 'b.ts', 'c.ts']));
  });
});

describe('applyAddDeps', () => {
  it('adds cursor file and its in-project imports', () => {
    const allPaths = new Set(files.map(f => f.path));
    const result = applyAddDeps(new Set(), files[0], imports, allPaths);
    expect(result).toEqual(new Set(['a.ts', 'b.ts']));
  });

  it('ignores deps not in the project file list', () => {
    const importsWithExternal = new Map([['a.ts', ['external.ts', 'b.ts']]]);
    const allPaths = new Set(['a.ts', 'b.ts', 'c.ts']);
    const result = applyAddDeps(new Set(), files[0], importsWithExternal, allPaths);
    expect(result.has('external.ts')).toBe(false);
    expect(result.has('b.ts')).toBe(true);
  });

  it('is additive — does not clear existing selection', () => {
    const allPaths = new Set(files.map(f => f.path));
    const result = applyAddDeps(new Set(['c.ts']), files[0], imports, allPaths);
    expect(result.has('c.ts')).toBe(true);
  });
});

describe('clampCursor', () => {
  it('clamps below 0 to 0', () => {
    expect(clampCursor(-5, 3)).toBe(0);
  });

  it('clamps above length-1 to length-1', () => {
    expect(clampCursor(10, 3)).toBe(2);
  });

  it('returns 0 for empty list', () => {
    expect(clampCursor(0, 0)).toBe(0);
  });
});
