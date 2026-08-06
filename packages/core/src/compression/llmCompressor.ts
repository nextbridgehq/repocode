import { estimateFast } from '../tokens/fastEstimator.js';
import { DEFAULT_SUMMARIZE_PROMPT } from './promptTemplates.js';
import type { LLMProvider } from './providers/types.js';
import type { LLMCache } from './llmCache.js';

const DEFAULT_BUDGET_TOKENS = 8000;
const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 1000;
const JITTER_RATIO = 0.3;

/**
 * Delay before a given attempt (2-based: attempt 2 waits ~1s, attempt 3 ~2s).
 * Doubles each round, with +/-30% jitter so many files failing at once do not
 * retry in lockstep against the provider.
 */
function retryDelayMs(attempt: number): number {
  const base = BASE_RETRY_DELAY_MS * 2 ** (attempt - 2);
  const jitter = base * JITTER_RATIO * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

export async function llmCompress(
  content: string,
  filePath: string,
  provider: LLMProvider,
  cache?: LLMCache,
  budgetTokens = DEFAULT_BUDGET_TOKENS,
): Promise<string> {
  if (cache) {
    const cached = cache.get(content);
    if (cached !== undefined) return cached;
  }

  const inputTokens = estimateFast(content);
  if (inputTokens > budgetTokens) {
    process.stderr.write(
      `[repocode] warning: ${filePath} (${inputTokens} tokens) exceeds llm.budgetTokens (${budgetTokens}); falling back to tier2-structural\n`,
    );
    return content; // caller detects this case: input === output
  }

  let summary: string | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      summary = await provider.summarize(content, filePath, DEFAULT_SUMMARIZE_PROMPT);
      break;
    } catch (e: unknown) {
      lastError = e;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, retryDelayMs(attempt + 1)));
      }
    }
  }

  if (summary === undefined) {
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    process.stderr.write(
      `[repocode] warning: LLM compression failed for ${filePath} after ${MAX_ATTEMPTS} attempts: ${message}\n`,
    );
    return content;
  }

  // Deliberately no cache.save() here. Saving rewrites the whole cache file, so
  // doing it per summary made N compressions cost N full-file writes. The caller
  // (fitToBudget) flushes once when the run finishes.
  cache?.set(content, summary);

  return summary;
}
