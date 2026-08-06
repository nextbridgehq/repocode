import { describe, it, expect } from 'vitest';
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

  it('compress:none uses 1.2x multiplier (candidateCount ≈ budget/medianTokens * 1.2)', () => {
    // 20 files, each ~500 tokens, budget=5000 → effectiveBudget/medianTokens = 10
    // none: floor(10 * 1.2) = 12 candidates
    const files = makeFiles(20);
    const { candidates } = selectCandidates(files, 5000, [], 'none');
    expect(candidates.length).toBeLessThanOrEqual(12);
    expect(candidates.length).toBeGreaterThanOrEqual(10);
  });

  it('compress:tier1-regex uses 2.0x multiplier', () => {
    const files = makeFiles(20);
    const { candidates } = selectCandidates(files, 5000, [], 'tier1-regex');
    // floor(10 * 2.0) = 20 — capped at 20 (total files)
    expect(candidates.length).toBe(20);
  });

  it('defaults to partial (3x) when compress param is omitted', () => {
    const files = makeFiles(20);
    const { candidates: withDefault } = selectCandidates(files, 5000, []);
    const { candidates: withPartial } = selectCandidates(files, 5000, [], 'partial');
    expect(withDefault.length).toBe(withPartial.length);
  });
});
