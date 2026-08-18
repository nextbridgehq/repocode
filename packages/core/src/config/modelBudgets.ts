/**
 * Default token budgets derived from a model's context window.
 *
 * `--budget 50k` asks the user to know a number they mostly don't; `--model claude-opus-5`
 * asks them something they already know. This module turns the second into the first.
 *
 * The table below is a snapshot of vendor documentation, not a fact about this tool, and it
 * will go stale — the models are versioned faster than this package is. Two consequences are
 * built in rather than papered over: every entry carries a verification date, and an unknown
 * model is reported as unknown instead of being guessed at from a prefix.
 */

export interface ModelSpec {
  /** Total context window in tokens. */
  contextWindow: number;
  /** Maximum tokens the model can emit in one response. */
  maxOutput: number;
}

/** The date the figures below were last checked against vendor documentation. */
export const MODEL_TABLE_VERIFIED_ON = '2026-08-13';

/**
 * Share of the context window held back for the conversation wrapped around the pack —
 * the user's questions and the model's earlier answers. Proportional rather than fixed:
 * a reserve sized for a 1M model would consume half of a 200k one.
 */
const CONVERSATION_RESERVE = 0.15;

export const MODEL_BUDGETS: Record<string, ModelSpec> = {
  // Anthropic
  'claude-opus-5': { contextWindow: 1_000_000, maxOutput: 128_000 },
  'claude-opus-4-8': { contextWindow: 1_000_000, maxOutput: 128_000 },
  'claude-sonnet-5': { contextWindow: 1_000_000, maxOutput: 128_000 },
  'claude-sonnet-4-6': { contextWindow: 1_000_000, maxOutput: 128_000 },
  'claude-haiku-4-5': { contextWindow: 200_000, maxOutput: 64_000 },

  // OpenAI. "gpt-5" is a family rather than a model; the specific versions are listed so a
  // budget is never derived from an ambiguous name.
  'gpt-5.6': { contextWindow: 1_050_000, maxOutput: 128_000 },
  'gpt-5.5': { contextWindow: 1_000_000, maxOutput: 128_000 },
  'gpt-5.4': { contextWindow: 1_050_000, maxOutput: 128_000 },

  // Google
  'gemini-2.5-pro': { contextWindow: 1_048_576, maxOutput: 65_536 },
};

/**
 * Short names people actually type. Deliberately explicit: resolving "opus" by prefix-matching
 * the table would silently follow whichever Opus happened to sort first.
 */
const ALIASES: Record<string, string> = {
  opus: 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
  'gpt-5': 'gpt-5.6',
  'gemini-2.5': 'gemini-2.5-pro',
};

/** Canonical model ids, sorted — the order `--help` and error messages present them in. */
export function knownModels(): string[] {
  return Object.keys(MODEL_BUDGETS).sort();
}

/** Every accepted spelling, canonical ids and aliases alike, sorted. */
export function knownModelNames(): string[] {
  return [...Object.keys(MODEL_BUDGETS), ...Object.keys(ALIASES)].sort();
}

/**
 * Default pack budget for `model`, or null if the model is not in the table.
 *
 * Null rather than a fallback: a budget guessed from an unrecognised name would silently
 * truncate a pack, and the caller can say so far more usefully than this function can.
 */
export function budgetForModel(model: string): number | null {
  const key = model.trim().toLowerCase();
  const spec = MODEL_BUDGETS[ALIASES[key] ?? key];
  if (!spec) return null;

  const budget = spec.contextWindow - spec.maxOutput - Math.round(spec.contextWindow * CONVERSATION_RESERVE);
  // Guards the table rather than the arithmetic: a future entry whose max output dominates
  // its context window would otherwise yield a zero or negative budget.
  return budget > 0 ? budget : null;
}
