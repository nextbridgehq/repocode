import { describe, it, expect, vi } from 'vitest';
import { rankPass1, selectCandidates } from '../../src/ranking/pass1Ranker.js';
import type { DiscoveredFile } from '../../src/types.js';
import { ZERO_SIGNALS } from '../helpers.js';

function makeFile(p: string, size = 500): DiscoveredFile {
  return {
    path: p, absolutePath: `/root/${p}`, size,
    language: 'typescript', mtime: new Date(), isBinary: false, source: 'normal',
  };
}

describe('rankPass1', () => {
  it('ranks index.ts higher than a deep utility file', () => {
    const files = [
      makeFile('src/utils/helpers.ts'),
      makeFile('src/index.ts'),
    ];
    const ranked = rankPass1(files, { keywords: [], pinned: [] });
    expect(ranked[0].path).toBe('src/index.ts');
  });

  it('each file has a score between 0 and 1', () => {
    const files = [makeFile('src/foo.ts'), makeFile('src/bar.json')];
    const ranked = rankPass1(files, { keywords: [], pinned: [] });
    ranked.forEach(f => {
      expect(f.score).toBeGreaterThanOrEqual(0);
      expect(f.score).toBeLessThanOrEqual(1);
    });
  });

  it('orders score ties by path so input order cannot change the result', () => {
    // Same directory, same size, same mtime, same extension → identical scores.
    const mtime = new Date();
    const tied = ['src/charlie.ts', 'src/alpha.ts', 'src/bravo.ts'].map(p => ({
      ...makeFile(p), mtime,
    }));

    const ranked = rankPass1(tied, { keywords: [], pinned: [] });

    expect(new Set(ranked.map(f => f.score)).size).toBe(1); // guard: really tied
    expect(ranked.map(f => f.path)).toEqual([
      'src/alpha.ts', 'src/bravo.ts', 'src/charlie.ts',
    ]);
  });

  it('produces the same ranking when the input is shuffled', () => {
    const mtime = new Date();
    const paths = ['src/b.ts', 'src/a.ts', 'lib/c.ts', 'lib/a.ts', 'src/index.ts'];
    const files = paths.map(p => ({ ...makeFile(p), mtime }));

    const forward = rankPass1(files, { keywords: [], pinned: [] });
    const reversed = rankPass1([...files].reverse(), { keywords: [], pinned: [] });

    expect(reversed.map(f => f.path)).toEqual(forward.map(f => f.path));
  });

  it('is unaffected by the clock advancing between file evaluations', () => {
    const mtime = new Date();
    const files = ['src/b.ts', 'src/a.ts', 'lib/c.ts', 'lib/a.ts']
      .map(p => ({ ...makeFile(p), mtime }));

    // Recency reads the clock; if it reads it per file, whichever file is scored last
    // looks fractionally older and the ranking depends on input order.
    const clock = vi.spyOn(Date, 'now');
    let t = mtime.getTime();
    clock.mockImplementation(() => t++);

    try {
      const forward = rankPass1(files, { keywords: [], pinned: [] });
      const reversed = rankPass1([...files].reverse(), { keywords: [], pinned: [] });
      expect(reversed.map(f => f.path)).toEqual(forward.map(f => f.path));
    } finally {
      clock.mockRestore();
    }
  });
});

describe('selectCandidates', () => {
  it('returns all files when count < 3x budget capacity', () => {
    const files = [makeFile('a.ts', 100), makeFile('b.ts', 100)].map((f, i) => ({
      ...f, score: i === 0 ? 0.9 : 0.5, signalScores: ZERO_SIGNALS,
    }));
    const { candidates, dropped } = selectCandidates(files, 100_000, []);
    expect(candidates.length).toBe(2);
    expect(dropped.length).toBe(0);
  });

  it('always includes pinned files regardless of score', () => {
    const files = Array.from({ length: 10 }, (_, i) =>
      ({ ...makeFile(`src/file${i}.ts`, 10_000), score: 0.1, signalScores: ZERO_SIGNALS })
    );
    // budget = 5000 tokens, each file ~2500 tokens → 3x capacity = ~6 files
    // pinned file is the last one (lowest score)
    files[9].path = 'src/pinned.ts';
    const { candidates } = selectCandidates(files, 5_000, ['src/pinned.ts']);
    expect(candidates.some(f => f.path === 'src/pinned.ts')).toBe(true);
  });
});

describe('selectCandidates — graduated multiplier', () => {
  function makeFiles(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      path: `file${i}.ts`,
      score: 1 - i * 0.001,
      size: 2000,      // ~500 tokens fast estimate (2000/4)
      language: 'TypeScript',
      mtime: new Date(),
      absolutePath: `/repo/file${i}.ts`,
      isBinary: false,
      source: 'normal' as const,
      signalScores: {
        structural: 0.5,
        depth: 0.5,
        size: 0.5,
        extension: 0.5,
        keyword: 0.5,
        recency: 0.5,
      },
    }));
  }

  it('selects more candidates with compress:partial than compress:none for the same budget', () => {
    const files = makeFiles(100);
    const budget = 10_000; // 10k effective budget

    const { candidates: withNone } = selectCandidates(files, budget, [], 'none');
    const { candidates: withPartial } = selectCandidates(files, budget, [], 'partial');

    expect(withNone.length).toBeLessThan(withPartial.length);
  });

  it('compress:none uses a 0.5x multiplier (candidateCount ≈ budget/medianTokens * 0.5)', () => {
    // 50 files, each ~500 tokens, budget=5000 → effectiveBudget/medianTokens = 10
    // none: floor(10 * 0.5) = 5 candidates
    const files = makeFiles(50);
    const { candidates } = selectCandidates(files, 5000, [], 'none');
    expect(candidates.length).toBe(5);
  });

  it('compress:tier1-regex uses a 0.6x multiplier', () => {
    const files = makeFiles(50);
    const { candidates } = selectCandidates(files, 5000, [], 'tier1-regex');
    // floor(10 * 0.6) = 6 candidates
    expect(candidates.length).toBe(6);
  });

  it('always considers at least one candidate, even when the budget floors the count to zero', () => {
    // Sub-1.0 multipliers mean a budget smaller than ~1.25 median files rounds to zero.
    // Returning nothing would report a too-large file as never considered rather than as
    // exceeding the budget, which is the reason a caller actually needs.
    const files = makeFiles(5);   // ~500 tokens each
    const { candidates } = selectCandidates(files, 100, [], 'partial');
    expect(candidates.length).toBe(1);
  });

  it('considers fewer files than would fit whole, leaving the fitter upgrade headroom', () => {
    // The property the numbers encode: a multiplier under 1.0. Considering more candidates
    // than the budget can hold at full size is what drove every retrieval down to an ~11%
    // signature — see results_phase1gate_precision.csv.
    const files = makeFiles(200);
    const budget = 5000; // ~10 median files fit whole
    for (const level of ['none', 'tier1-regex', 'tier2-structural', 'partial'] as const) {
      const { candidates } = selectCandidates(files, budget, [], level);
      expect(candidates.length).toBeLessThan(10);
    }
  });

  it('defaults to partial (3x) when compress param is omitted', () => {
    const files = makeFiles(20);
    const { candidates: withDefault } = selectCandidates(files, 5000, []);
    const { candidates: withPartial } = selectCandidates(files, 5000, [], 'partial');
    expect(withDefault.length).toBe(withPartial.length);
  });
});
