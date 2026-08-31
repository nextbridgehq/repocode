import { describe, it, expect } from 'vitest';
import { rankPass2 } from '../../src/ranking/pass2Ranker.js';
import type { RankedFile } from '../../src/types.js';

function makeRanked(p: string, size: number, score: number): RankedFile {
  return {
    path: p, absolutePath: `/root/${p}`,
    size, language: 'typescript', mtime: new Date(), isBinary: false,
    source: 'normal', score,
    signalScores: { structural: 0, depth: 0, size: 0, extension: 0, keyword: 0, recency: 0 },
  };
}

describe('rankPass2', () => {
  it('ranks small high-score file above large medium-score file', () => {
    // small file (100 bytes), high pass1 score → high density
    const small = makeRanked('small.ts', 100, 0.9);
    // large file (50000 bytes), medium pass1 score → low density
    const large = makeRanked('large.ts', 50_000, 0.7);
    // large has higher pass1 score, but small wins on density
    const large2 = makeRanked('large2.ts', 50_000, 0.95);
    const result = rankPass2([large2, large, small], []);
    expect(result[0].path).toBe('small.ts');
  });

  it('overwrites .score with normalised density in 0-1 range', () => {
    const files = [
      makeRanked('a.ts', 400, 0.8),
      makeRanked('b.ts', 1600, 0.4),
    ];
    const result = rankPass2(files, []);
    for (const f of result) {
      expect(f.score).toBeGreaterThanOrEqual(0);
      expect(f.score).toBeLessThanOrEqual(1);
    }
  });

  it('pinned files placed at front with .score unchanged', () => {
    const pinned = makeRanked('pinned.ts', 100_000, 0.1); // very low density
    const other = makeRanked('other.ts', 100, 0.9);       // very high density
    const result = rankPass2([other, pinned], ['pinned.ts']);
    expect(result[0].path).toBe('pinned.ts');
    expect(result[0].score).toBe(0.1); // unchanged
  });

  it('single file: does not divide by zero', () => {
    const file = makeRanked('a.ts', 0, 0.5);
    expect(() => rankPass2([file], [])).not.toThrow();
  });

  it('all same density: preserves original order (stable sort)', () => {
    const files = [
      makeRanked('a.ts', 400, 0.5),
      makeRanked('b.ts', 400, 0.5),
      makeRanked('c.ts', 400, 0.5),
    ];
    const result = rankPass2(files, []);
    expect(result.map(f => f.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('scores differing by < 1e-10 maintain original relative order', () => {
    const files = [
      makeRanked('a.ts', 400, 0.5),
      makeRanked('b.ts', 400, 0.5 + 1e-15), // negligible difference
    ];
    const result = rankPass2(files, []);
    expect(result[0].path).toBe('a.ts');
    expect(result[1].path).toBe('b.ts');
  });

  it('with centralityMap: centrality=1.0/density=0.5 file outranks centrality=0/density=0.6 file', () => {
    // C acts as the density normalizer (density=1.0)
    // After normalization: A.density=0.5, B.density=0.6, C.density=1.0
    // Blended: A = 0.7*0.5 + 0.3*1.0 = 0.65, B = 0.7*0.6 + 0.3*0 = 0.42
    const a = makeRanked('a.ts', 100, 0.5);
    const b = makeRanked('b.ts', 100, 0.6);
    const c = makeRanked('c.ts', 100, 1.0);
    const centralityMap = new Map([
      ['/root/a.ts', 1.0],
      ['/root/b.ts', 0],
      ['/root/c.ts', 0],
    ]);
    const result = rankPass2([a, b, c], [], centralityMap);
    const aIdx = result.findIndex(f => f.path === 'a.ts');
    const bIdx = result.findIndex(f => f.path === 'b.ts');
    expect(aIdx).toBeLessThan(bIdx);
  });

  it('without centralityMap: ranking is pure density (same as Phase 3)', () => {
    const a = makeRanked('a.ts', 100, 0.5); // lower density
    const b = makeRanked('b.ts', 100, 0.8); // higher density
    const withMap = rankPass2([a, b], []);
    const withoutMap = rankPass2([a, b], [], undefined);
    expect(withMap.map(f => f.path)).toEqual(withoutMap.map(f => f.path));
    expect(withMap[0].path).toBe('b.ts'); // highest density wins
  });

  it('pinned files remain at front regardless of centrality score', () => {
    const pinned = makeRanked('pinned.ts', 100_000, 0.1); // low density
    const other  = makeRanked('other.ts',  100,     0.9); // high density
    const centralityMap = new Map([
      ['/root/pinned.ts', 0],   // zero centrality
      ['/root/other.ts',  0.5],
    ]);
    const result = rankPass2([other, pinned], ['pinned.ts'], centralityMap);
    expect(result[0].path).toBe('pinned.ts');
    expect(result[0].score).toBe(0.1); // pinned score unchanged
  });

  it('keeps the relative order of files when the set grows, given a shared density scale', () => {
    // a: low density, high centrality. b: 10x a's density, no centrality.
    // c: extreme density — present only in the larger set, and the set-local maximum.
    const a = makeRanked('a.ts', 4000, 0.5);
    const b = makeRanked('b.ts', 400, 0.5);
    const c = makeRanked('c.ts', 4, 0.5);
    const centralityMap = new Map([['/root/a.ts', 1.0]]);
    const densityScale = 0.5; // c's raw density — fixed, computed over the whole repo

    const small = rankPass2([a, b], [], centralityMap, densityScale).map(f => f.path);
    const large = rankPass2([a, b, c], [], centralityMap, densityScale).map(f => f.path);

    expect(large.filter(p => p !== 'c.ts')).toEqual(small);
  });
});
