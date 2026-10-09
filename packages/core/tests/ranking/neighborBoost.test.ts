import { describe, it, expect } from 'vitest';
import { neighborBoost } from '../../src/ranking/neighborBoost.js';
import type { RankedFile } from '../../src/types.js';

function makeRanked(p: string, score: number): RankedFile {
  return {
    path: p, absolutePath: `/root/${p}`,
    size: 100, language: 'python', mtime: new Date(), isBinary: false,
    source: 'normal', score,
    signalScores: { structural: 0, depth: 0, size: 0, extension: 0, keyword: 0, recency: 0 },
  };
}

const opts = { pinned: [] as string[], seeds: 2, beta: 0.1 };

describe('neighborBoost', () => {
  // The file a bug is in is often one import away from a file the query names strongly
  // (benchmark: gold file inside the top 12 for 8 more whole-issue instances, 1 fewer, of 274).
  it('lifts a file that a top-ranked file imports above a slightly better unrelated file', () => {
    const files = [
      makeRanked('app/view.py', 0.9),
      makeRanked('app/other.py', 0.5),
      makeRanked('app/unrelated.py', 0.46),
      makeRanked('app/model.py', 0.42),
    ];
    const imports = { 'app/view.py': ['app/model.py'] };
    const out = neighborBoost(files, imports, opts).map(f => f.path);
    expect(out.indexOf('app/model.py')).toBeLessThan(out.indexOf('app/unrelated.py'));
  });

  it('works in the importer direction too', () => {
    const files = [makeRanked('lib/core.py', 0.9), makeRanked('lib/x.py', 0.5), makeRanked('lib/user.py', 0.45)];
    const out = neighborBoost(files, { 'lib/user.py': ['lib/core.py'] }, { ...opts, seeds: 1 }).map(f => f.path);
    expect(out.indexOf('lib/user.py')).toBeLessThan(out.indexOf('lib/x.py'));
  });

  it('does not pull in a file that is only two hops from a seed', () => {
    const files = [makeRanked('a.py', 0.9), makeRanked('x.py', 0.5), makeRanked('c.py', 0.46)];
    const out = neighborBoost(files, { 'a.py': ['b.py'], 'b.py': ['c.py'] }, { ...opts, seeds: 1 }).map(f => f.path);
    expect(out).toEqual(['a.py', 'x.py', 'c.py']);
  });

  it('boosts by the best neighbouring seed once, not by their sum', () => {
    const files = [makeRanked('s1.py', 0.9), makeRanked('s2.py', 0.8), makeRanked('t.py', 0.3)];
    const [,, t] = neighborBoost(files, { 's1.py': ['t.py'], 's2.py': ['t.py'] }, opts);
    expect(t.score).toBeCloseTo(0.3 + 0.1 * 0.9);
  });

  it('leaves the order alone when no file has a neighbour in the seeds', () => {
    const files = [makeRanked('a.py', 0.9), makeRanked('b.py', 0.5), makeRanked('c.py', 0.4)];
    expect(neighborBoost(files, {}, opts).map(f => f.path)).toEqual(['a.py', 'b.py', 'c.py']);
  });

  it('keeps pinned files first and does not seed from them', () => {
    const files = [makeRanked('pin.py', 0.95), makeRanked('a.py', 0.9), makeRanked('b.py', 0.5), makeRanked('c.py', 0.46)];
    const out = neighborBoost(files, { 'pin.py': ['c.py'] }, { pinned: ['pin.py'], seeds: 1, beta: 0.1 }).map(f => f.path);
    expect(out[0]).toBe('pin.py');
    expect(out.slice(1)).toEqual(['a.py', 'b.py', 'c.py']);
  });

  it('breaks score ties by path so the order never depends on input order', () => {
    const a = [makeRanked('z.py', 0.5), makeRanked('y.py', 0.5)];
    const b = [makeRanked('y.py', 0.5), makeRanked('z.py', 0.5)];
    expect(neighborBoost(a, {}, opts).map(f => f.path)).toEqual(neighborBoost(b, {}, opts).map(f => f.path));
  });
});
