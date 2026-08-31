import { describe, it, expect } from 'vitest';
import { formatCompactExplanation, type CompactExplainInput } from '../../src/output/compactExplain.js';

function makeIncluded(path: string, score: number, signalScores: Partial<CompactExplainInput['included'][number]['signalScores']> = {}) {
  return {
    path,
    score,
    signalScores: {
      structural: 0,
      depth: 0,
      size: 0,
      extension: 0,
      keyword: 0,
      recency: 0,
      ...signalScores,
    },
  };
}

describe('formatCompactExplanation', () => {
  it('picks the signal with the highest score as dominant', () => {
    const result: CompactExplainInput = {
      totalTokens: 100,
      outputTokens: 100,
      budget: { maxTokens: 1000 },
      included: [makeIncluded('src/a.ts', 0.9, { keyword: 0.9, structural: 0.2 })],
      excluded: [],
    };
    const text = formatCompactExplanation('do the thing', result);
    expect(text).toContain('top signal: keyword');
  });

  it('lets extension win as the dominant signal', () => {
    const result: CompactExplainInput = {
      totalTokens: 100,
      outputTokens: 100,
      budget: { maxTokens: 1000 },
      included: [makeIncluded('src/a.ts', 0.9, { extension: 0.9, keyword: 0.3 })],
      excluded: [],
    };
    const text = formatCompactExplanation('do the thing', result);
    expect(text).toContain('top signal: extension');
  });

  it('breaks ties by structural, depth, size, extension, keyword, recency order', () => {
    const result: CompactExplainInput = {
      totalTokens: 100,
      outputTokens: 100,
      budget: { maxTokens: 1000 },
      included: [makeIncluded('src/a.ts', 0.5, { structural: 0.5, depth: 0.5, keyword: 0.5 })],
      excluded: [],
    };
    const text = formatCompactExplanation('do the thing', result);
    expect(text).toContain('top signal: structural');
  });

  it('follows SIGNAL_ORDER itself on a tie, not just "first entry wins"', () => {
    const result: CompactExplainInput = {
      totalTokens: 100,
      outputTokens: 100,
      budget: { maxTokens: 1000 },
      included: [makeIncluded('src/a.ts', 0.5, { depth: 0.5, size: 0.5 })],
      excluded: [],
    };
    const text = formatCompactExplanation('do the thing', result);
    expect(text).toContain('top signal: depth');
  });

  it('numbers included files starting at 1 and shows rounded score', () => {
    const result: CompactExplainInput = {
      totalTokens: 100,
      outputTokens: 100,
      budget: { maxTokens: 1000 },
      included: [
        makeIncluded('src/a.ts', 0.912, { keyword: 0.912 }),
        makeIncluded('src/b.ts', 0.5, { structural: 0.5 }),
      ],
      excluded: [],
    };
    const text = formatCompactExplanation('do the thing', result);
    expect(text).toContain('1. src/a.ts (score 0.91, top signal: keyword)');
    expect(text).toContain('2. src/b.ts (score 0.50, top signal: structural)');
  });

  it('caps the included list at 20 with a remainder note', () => {
    const included = Array.from({ length: 25 }, (_, i) =>
      makeIncluded(`file${i}.ts`, 0.5, { structural: 0.5 }),
    );
    const result: CompactExplainInput = {
      totalTokens: 100,
      outputTokens: 100,
      budget: { maxTokens: 1000 },
      included,
      excluded: [],
    };
    const text = formatCompactExplanation('do the thing', result);
    expect(text).toContain('file19.ts');
    expect(text).not.toContain('file20.ts');
    expect(text).toContain('...and 5 more.');
  });

  it('groups exclusions by reason with counts, most frequent first, and never lists individual excluded paths', () => {
    const result: CompactExplainInput = {
      totalTokens: 100,
      outputTokens: 100,
      budget: { maxTokens: 1000 },
      included: [],
      excluded: [
        { path: 'a.ts', reason: 'below-candidate-cut' },
        { path: 'b.ts', reason: 'below-candidate-cut' },
        { path: 'c.ts', reason: 'exceeds-budget' },
      ],
    };
    const text = formatCompactExplanation('do the thing', result);
    expect(text).toContain('Excluded (3 files): 2 below-candidate-cut, 1 exceeds-budget');
    expect(text).not.toContain('a.ts');
  });

  it('omits the excluded line entirely when nothing was excluded', () => {
    const result: CompactExplainInput = {
      totalTokens: 100,
      outputTokens: 100,
      budget: { maxTokens: 1000 },
      included: [makeIncluded('src/a.ts', 0.9, { keyword: 0.9 })],
      excluded: [],
    };
    const text = formatCompactExplanation('do the thing', result);
    expect(text).not.toContain('Excluded');
  });

  it('includes the task and a budget line with percentage when budget is set, using outputTokens rather than totalTokens', () => {
    const result: CompactExplainInput = {
      totalTokens: 4200,
      outputTokens: 5000,
      budget: { maxTokens: 100000 },
      included: [],
      excluded: [],
    };
    const text = formatCompactExplanation('fix the login redirect bug', result);
    expect(text).toContain('Task: "fix the login redirect bug"');
    // outputTokens (5000) differs from totalTokens (4200) here on purpose: if the budget line
    // ever regresses to reading totalTokens, this assertion fails instead of passing vacuously.
    expect(text).toContain('Budget: 5,000 / 100,000 tokens (5%)');
    expect(text).not.toContain('4,200');
    expect(text).not.toContain('(4%)');
  });

  it('shows "no budget" when budget is null, using outputTokens rather than totalTokens', () => {
    const result: CompactExplainInput = {
      totalTokens: 4200,
      outputTokens: 5000,
      budget: null,
      included: [],
      excluded: [],
    };
    const text = formatCompactExplanation('fix the login redirect bug', result);
    expect(text).toContain('Budget: 5,000 tokens (no budget)');
    expect(text).not.toContain('4,200');
  });
});
