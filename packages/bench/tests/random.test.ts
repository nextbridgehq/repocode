import { describe, it, expect } from 'vitest';
import { shuffleSeeded, fillRandomly } from '../src/arms/random.js';

const files = Array.from({ length: 20 }, (_, i) => ({ path: `f${i}.py`, size: (i + 1) * 100 }));

describe('shuffleSeeded', () => {
  it('is deterministic for a given seed', () => {
    expect(shuffleSeeded(files, 42).map(f => f.path))
      .toEqual(shuffleSeeded(files, 42).map(f => f.path));
  });

  it('produces a different order for a different seed', () => {
    expect(shuffleSeeded(files, 1).map(f => f.path))
      .not.toEqual(shuffleSeeded(files, 2).map(f => f.path));
  });

  it('is a permutation — same members, none lost or duplicated', () => {
    const shuffled = shuffleSeeded(files, 7).map(f => f.path).sort();
    expect(shuffled).toEqual(files.map(f => f.path).sort());
  });

  it('does not mutate its input', () => {
    const before = files.map(f => f.path);
    shuffleSeeded(files, 99);
    expect(files.map(f => f.path)).toEqual(before);
  });
});

describe('fillRandomly', () => {
  it('never exceeds the budget', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const total = fillRandomly(files, 1000, seed).reduce((s, r) => s + r.chars, 0);
      expect(total).toBeLessThanOrEqual(1000);
    }
  });

  it('reports the whole file as delivered, since this arm does not compress', () => {
    // This is what makes it a fair floor: its hits are whole files, so a compressing arm
    // cannot book a fragment against them.
    const picked = fillRandomly([{ path: 'a', size: 40 }], 1000, 1);
    expect(picked).toEqual([{ path: 'a', chars: 40 }]);
  });

  it('keeps filling past a file that does not fit, rather than stopping', () => {
    // A floor should represent "pick at random until the budget is full". Stopping at the
    // first oversized file would understate what random selection actually achieves.
    const items = [{ path: 'huge', size: 900 }, { path: 'a', size: 10 }, { path: 'b', size: 10 }];
    // Seed chosen so 'huge' comes first; whatever the order, both small files must fit in 100.
    const picked = fillRandomly(items, 100, 1).map(r => r.path);
    expect(picked).toContain('a');
    expect(picked).toContain('b');
    expect(picked).not.toContain('huge');
  });

  it('returns nothing when no file fits', () => {
    expect(fillRandomly([{ path: 'x', size: 500 }], 100, 1)).toEqual([]);
  });

  it('is deterministic for a given seed', () => {
    expect(fillRandomly(files, 5000, 3)).toEqual(fillRandomly(files, 5000, 3));
  });
});
