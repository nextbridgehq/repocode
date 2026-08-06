import { describe, it, expect } from 'vitest';
import { computeBudget } from '../../src/budget/computeBudget.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import type { RepoCodeConfig, RankedFile } from '../../src/types.js';

function makeConfig(over: Partial<RepoCodeConfig> = {}): RepoCodeConfig {
  return {
    ...DEFAULT_CONFIG,
    root: '/tmp/x',
    ...over,
    budget: { ...DEFAULT_CONFIG.budget, ...(over.budget ?? {}) },
  } as RepoCodeConfig;
}

function makeFiles(n: number, tokensEach = 100): RankedFile[] {
  return Array.from({ length: n }, (_, i) => ({
    path: `src/f${i}.ts`,
    absolutePath: `/tmp/x/src/f${i}.ts`,
    tokens: tokensEach,
    score: 1000 - i,
    isBinary: false,
    language: 'typescript',
    sizeBytes: tokensEach * 4,
    signalScores: {
      structural: 0, depth: 0, size: 0, extension: 0, keyword: 0, recency: 0,
    },
  })) as unknown as RankedFile[];
}

describe('computeBudget', () => {
  it('subtracts both reserves and overhead from maxTokens', () => {
    const config = makeConfig({
      budget: { maxTokens: 100_000, reserveForResponse: 4_000, reserveForPrompt: 1_000 },
    });
    const { budget } = computeBudget(makeFiles(20), config, '');

    expect(budget.maxTokens).toBe(100_000);
    expect(budget.reserveForResponse).toBe(4_000);
    expect(budget.reserveForPrompt).toBe(1_000);
    // Overhead is non-zero, so effective must be strictly below maxTokens minus reserves.
    expect(budget.effectiveBudget).toBeLessThan(95_000);
    expect(budget.effectiveBudget).toBeGreaterThan(0);
  });

  it('never returns a negative effective budget when reserves exceed maxTokens', () => {
    const config = makeConfig({
      budget: { maxTokens: 1_000, reserveForResponse: 5_000, reserveForPrompt: 5_000 },
    });
    const { budget } = computeBudget(makeFiles(5), config, '');
    expect(budget.effectiveBudget).toBe(0);
  });

  it('charges instruction content against the budget', () => {
    const config = makeConfig({
      budget: { maxTokens: 100_000, reserveForResponse: 0, reserveForPrompt: 0 },
    });
    const withoutInstruction = computeBudget(makeFiles(20), config, '');
    const withInstruction = computeBudget(makeFiles(20), config, 'x'.repeat(8_000));

    expect(withInstruction.budget.effectiveBudget)
      .toBeLessThan(withoutInstruction.budget.effectiveBudget);
  });

  it('reports dropped files as excluded rather than dropping them silently', () => {
    const config = makeConfig({
      budget: { maxTokens: 2_000, reserveForResponse: 0, reserveForPrompt: 0 },
    });
    const files = makeFiles(200, 500);
    const { candidates, dropped } = computeBudget(files, config, '');

    expect(candidates.length).toBeLessThan(files.length);
    expect(candidates.length + dropped.length).toBe(files.length);
  });
});
