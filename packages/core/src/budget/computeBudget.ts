import type { RankedFile, RepoCodeConfig, TokenBudget, ExcludedFile } from '../types.js';
import { selectCandidates } from '../ranking/pass1Ranker.js';
import { estimateOverhead } from './overhead.js';

export interface ComputedBudget {
  candidates: RankedFile[];
  dropped: ExcludedFile[];
  budget: TokenBudget;
}

/**
 * Resolve the effective token budget and the candidate set that fits it.
 *
 * Two passes are required because output overhead (tree, metadata, header,
 * instructions) scales with the number of candidates, but the candidate count
 * is itself a function of the budget. The first pass uses an overhead-free
 * budget purely to establish a realistic candidate count; the second pass
 * re-selects against the budget corrected by that count's overhead.
 */
export function computeBudget(
  ranked: RankedFile[],
  config: RepoCodeConfig,
  instructionContent: string,
): ComputedBudget {
  const reserved =
    config.budget.reserveForResponse + config.budget.reserveForPrompt;

  // maxTokens is non-null on this path — the no-budget case never gets here.
  const maxTokens = config.budget.maxTokens as number;

  // Pass 1: preliminary budget ignoring overhead, to get a candidate count.
  // Clamped at 0 so a reserve larger than the budget cannot go negative.
  const preliminaryBudget = Math.max(0, maxTokens - reserved);
  const { candidates: preliminaryCandidates } = selectCandidates(
    ranked, preliminaryBudget, config.ranking.pinned, config.compress, config.maxCandidates
  );

  // Pass 2: correct the budget using overhead for the real candidate count.
  const effectiveBudget = Math.max(
    0,
    maxTokens - reserved - estimateOverhead(
      preliminaryCandidates.length,
      config.output.headerText,
      instructionContent,
    ),
  );

  const { candidates, dropped } = selectCandidates(
    ranked, effectiveBudget, config.ranking.pinned, config.compress, config.maxCandidates
  );

  return {
    candidates,
    dropped,
    budget: {
      maxTokens,
      reserveForResponse: config.budget.reserveForResponse,
      reserveForPrompt: config.budget.reserveForPrompt,
      effectiveBudget,
    },
  };
}
