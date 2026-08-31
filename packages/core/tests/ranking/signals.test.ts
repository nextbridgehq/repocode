import { describe, it, expect } from 'vitest';
import {
  structuralScore, depthScore, sizeScore,
  extensionScore, keywordScore, recencyScore,
} from '../../src/ranking/signals.js';

describe('structuralScore', () => {
  it('returns 1.0 for index.ts', () => expect(structuralScore('src/index.ts')).toBe(1.0));
  it('returns 0.75 for router.ts', () => expect(structuralScore('src/router.ts')).toBe(0.75));
  it('returns 0.5 for types.ts', () => expect(structuralScore('src/types.ts')).toBe(0.5));
  it('returns 0.1 for utils.ts', () => expect(structuralScore('src/utils.ts')).toBe(0.1));
});

describe('structuralScore — documentation entry points', () => {
  it('returns 1.0 for readme.md', () => expect(structuralScore('readme.md')).toBe(1.0));
  it('returns 1.0 for README.md (case-insensitive)', () => expect(structuralScore('README.md')).toBe(1.0));
  it('returns 1.0 for LICENSE (no extension)', () => expect(structuralScore('LICENSE')).toBe(1.0));
  it('returns 1.0 for changelog.md', () => expect(structuralScore('changelog.md')).toBe(1.0));
  it('returns 1.0 for a package-level README at any depth', () => expect(structuralScore('packages/cli/README.md')).toBe(1.0));
  it('does not boost an unrelated markdown file', () => expect(structuralScore('docs/notes.md')).toBe(0.1));
});

describe('depthScore', () => {
  it('returns 1.0 for depth 0', () => expect(depthScore('index.ts')).toBeCloseTo(1.0));
  it('decreases with depth', () => expect(depthScore('a/b/c/d.ts')).toBeLessThan(depthScore('a/b.ts')));
  it('handles deep monorepo paths gracefully', () => {
    const deep = depthScore('packages/core/src/discovery/ignoreRules.ts');
    expect(deep).toBeGreaterThan(0);
    expect(deep).toBeLessThan(0.5);
  });
});

describe('sizeScore', () => {
  it('returns 1.0 for smallest file', () => expect(sizeScore(0, 1000)).toBe(1.0));
  it('returns 0.0 for largest file', () => expect(sizeScore(1000, 1000)).toBe(0.0));
  it('returns 1.0 when maxFileSize is 0', () => expect(sizeScore(0, 0)).toBe(1.0));

  it('separates ordinary source files when one outlier sets the maximum', () => {
    // A repo whose largest file is a 500 KB vendored blob. Ordinary source files are all
    // under 10% of that, so a scale linear in bytes collapses them onto the same score and
    // the signal stops discriminating between them.
    const max = 500_000;
    const small = sizeScore(1_000, max);
    const medium = sizeScore(10_000, max);
    const large = sizeScore(50_000, max);

    expect(small).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(large);
    expect(small - large).toBeGreaterThan(0.2);
  });
});

describe('extensionScore', () => {
  it('returns 1.0 for .ts', () => expect(extensionScore('src/foo.ts')).toBe(1.0));
  it('returns 0.9 for .jsx', () => expect(extensionScore('src/foo.jsx')).toBe(0.9));
  it('returns 0.5 for .json', () => expect(extensionScore('src/foo.json')).toBe(0.5));
  it('returns 0.2 for .md', () => expect(extensionScore('README.md')).toBe(0.2));
});

describe('keywordScore', () => {
  const kws = ['auth', 'api', 'db'];
  it('returns 0 for no match', () => expect(keywordScore('src/utils.ts', kws)).toBe(0));
  it('returns > 0 for a match', () => expect(keywordScore('src/auth/login.ts', kws)).toBeGreaterThan(0));
  it('caps at 1.0', () => expect(keywordScore('auth/api/db.ts', kws)).toBeLessThanOrEqual(1.0));
});

describe('recencyScore', () => {
  it('returns ~1.0 for just-modified file', () => {
    const now = new Date();
    expect(recencyScore(now)).toBeCloseTo(1.0, 1);
  });
  it('returns lower score for older files', () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    expect(recencyScore(old)).toBeLessThan(0.1);
  });
});
