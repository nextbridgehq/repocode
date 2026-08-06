import fs from 'fs';
import type { RankedFile, BudgetFile, ExcludedFile, TokenBudget, CompressionLevel, CompressConfig, SecurityMode } from '../types.js';
import { getCompressionTier } from '../types.js';
import { estimateFast } from '../tokens/fastEstimator.js';
import { estimateAccurateBatch } from '../tokens/accurateEstimator.js';
import { compressTier1, compressTier2 } from './compression.js';
import { extractPartial } from './partialExtractor.js';
import type { FileCache } from '../cache/fileCache.js';
import type { LLMProvider } from '../compression/providers/types.js';
import type { LLMCache } from '../compression/llmCache.js';
import { scanForSecrets } from '../security/secretScanner.js';

import { pLimit } from '../utils/pLimit.js';

interface FitOptions {
  pinned: string[];
  compress: CompressConfig;
  cache?: FileCache;
  root?: string;
  llmProvider?: LLMProvider;
  llmCache?: LLMCache;
  llmBudgetTokens?: number;
  securityMode?: SecurityMode;  // if 'redact', secrets are scrubbed before LLM call
  concurrency?: number;
}

/** Minimum remaining budget (tokens) below which we stop fitting more files.
 *  Only applies when effectiveBudget itself is >= this value, so tests with
 *  tiny budgets are unaffected. Pinned files are always processed. */
const MIN_USEFUL_REMAINING_TOKENS = 200;

const LEVEL_ORDER: CompressionLevel[] = ['none', 'tier1-regex', 'tier2-structural', 'tier3-llm', 'partial'];

function levelIndex(level: CompressionLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

export async function fitToBudget(
  candidates: RankedFile[],
  options: FitOptions,
  budget: TokenBudget,
): Promise<{ included: BudgetFile[]; excluded: ExcludedFile[] }> {
  type Candidate = RankedFile & {
    content: string;
    tokens: number;
    compressed: boolean;
    compressionLevel: CompressionLevel;
    rankPosition: number;
  };
  const included: Candidate[] = [];
  const excluded: ExcludedFile[] = [];
  const pinnedSet = new Set(options.pinned);
  const processedPaths = new Set<string>();

  let remaining = budget.effectiveBudget;

  // Pinned files first, then ranked order
  const ordered = [
    ...candidates.filter(f => pinnedSet.has(f.path)),
    ...candidates.filter(f => !pinnedSet.has(f.path)),
  ];

  const limit = pLimit(options.concurrency ?? 4);
  const llmLimit = pLimit(2);

  // Phase 1: Parallel Read
  const readTasks = ordered.map(file => limit(async () => {
    try {
      const content = await fs.promises.readFile(file.absolutePath, 'utf-8');
      return { file, content, error: null };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[repocode] warning: failed to read ${file.path}: ${message}\n`);
      return { file, content: null, error: e };
    }
  }));

  const readResults = await Promise.all(readTasks);

  // Phase 2: Sequential Budget Decision
  let rankPosition = 0;

  for (const { file, content, error } of readResults) {
    // Early exit: remaining budget too small to be useful.
    if (remaining < MIN_USEFUL_REMAINING_TOKENS && budget.effectiveBudget >= MIN_USEFUL_REMAINING_TOKENS && !pinnedSet.has(file.path)) break;
    processedPaths.add(file.path);

    rankPosition++;

    if (error || typeof content !== 'string') {
      excluded.push({ path: file.path, reason: 'binary' }); // fallback reason for read errors
      continue;
    }

    // Guard against non-UTF-8 files
    const replacementChar = String.fromCharCode(0xFFFD);
    if (content.includes(replacementChar) && content.indexOf(replacementChar) < 100) {
      excluded.push({ path: file.path, reason: 'binary' });
      continue;
    }

    const fastTokens = estimateFast(content);

    // Level 1: try whole file
    if (fastTokens <= remaining) {
      included.push({ ...file, content, tokens: fastTokens, compressed: false, compressionLevel: 'none', rankPosition });
      remaining -= fastTokens;
      continue;
    }

    // Cascade: pinned files always use the full ceiling regardless of options.compress
    const ceiling = pinnedSet.has(file.path)
      ? 'partial'
      : getCompressionTier(rankPosition, options.compress);
    const maxLevel = levelIndex(ceiling);

    let fittedContent = content;
    let fittedTokens = fastTokens;
    let compressionLevel: CompressionLevel = 'none';
    let fitted = false;

    // Level 2: Tier 1 — strip comments
    if (!fitted && maxLevel >= levelIndex('tier1-regex')) {
      const t1 = compressTier1(content, file.language);
      const t1Tokens = estimateFast(t1);
      if (t1Tokens <= remaining) {
        fittedContent = t1; fittedTokens = t1Tokens; compressionLevel = 'tier1-regex'; fitted = true;
      } else {
        // Pass Tier 1 output to Tier 2 (cumulative)
        fittedContent = t1;

        // Level 3: Tier 2 — strip function bodies (operates on Tier 1 output)
        if (!fitted && maxLevel >= levelIndex('tier2-structural')) {
          const t2 = compressTier2(fittedContent, file.language);
          const t2Tokens = estimateFast(t2);
          if (t2Tokens <= remaining) {
            fittedContent = t2; fittedTokens = t2Tokens; compressionLevel = 'tier2-structural'; fitted = true;
          } else {
            // Pass Tier 2 output forward (cumulative)
            fittedContent = t2;

            // Level 3.5: Tier 3 — LLM semantic summary (operates on tier1+tier2 output)
            if (!fitted && maxLevel >= levelIndex('tier3-llm') && options.llmProvider) {
              const { llmCompress } = await import('../compression/llmCompressor.js');
              // Pre-redact secrets before sending to LLM and before caching the hash.
              // Redaction happens after tier2 so compressors operate on clean code.
              let t3Input = fittedContent;
              if (options.securityMode === 'redact') {
                const scan = await scanForSecrets(file.path, t3Input, 'redact');
                if (scan.redactedContent) {
                  t3Input = scan.redactedContent;
                }
              }
              const t3 = await llmLimit(async () => {
                await new Promise(resolve => setTimeout(resolve, 200));
                return llmCompress(
                  t3Input,
                  file.path,
                  options.llmProvider!,
                  options.llmCache,
                  options.llmBudgetTokens,
                );
              });
              if (t3 !== t3Input) {
                // llmCompress returned a summary (not the cost-guard passthrough)
                const t3Tokens = estimateFast(t3);
                if (t3Tokens <= remaining) {
                  fittedContent = t3; fittedTokens = t3Tokens; compressionLevel = 'tier3-llm'; fitted = true;
                }
              }
            }

            // Level 4: Partial — extract signatures + relevant sections
            if (!fitted && maxLevel >= levelIndex('partial')) {
              const partial = extractPartial(fittedContent, file.language, file.hunks);
              const partialTokens = estimateFast(partial);
              if (partialTokens <= remaining) {
                fittedContent = partial; fittedTokens = partialTokens; compressionLevel = 'partial'; fitted = true;
              }
            }
          }
        }
      }
    }

    if (fitted) {
      included.push({ ...file, content: fittedContent, tokens: fittedTokens, compressed: true, compressionLevel, rankPosition });
      remaining -= fittedTokens;
    } else if (pinnedSet.has(file.path)) {
      // Level 5: pinned force-include — whole file regardless of budget
      included.push({ ...file, content, tokens: fastTokens, compressed: false, compressionLevel: 'none', rankPosition });
      remaining -= fastTokens;
    } else {
      const reason = maxLevel > levelIndex('none')
        ? 'exceeds-budget-after-compression' as const
        : 'exceeds-budget' as const;
      excluded.push({ path: file.path, reason });
    }
  }

  // Files not reached due to early exit
  for (const file of ordered) {
    if (!processedPaths.has(file.path)) {
      excluded.push({ path: file.path, reason: 'exceeds-budget' });
    }
  }

  // Accurate token count for included files.
  // We use tiktoken for uncompressed files where the content on disk is unchanged.
  // For compressed files the on-disk content is the original (larger) file, so we use
  // the fast estimate of the compressed content computed during fitting.
  const accurateMap = await estimateAccurateBatch(
    included.filter(f => !f.compressed).map(f => f.absolutePath),
    options.cache,
    options.root,
  );

  let budgetFiles: BudgetFile[] = included.map(f => {
    const diskTokens = f.compressed
      ? undefined  // disk has original content, not compressed — don't use it
      : accurateMap.get(f.absolutePath);
    return {
      ...f,
      accurateTokens: diskTokens ?? f.tokens,
    };
  });

  // Correction loop: drop lowest-ranked (non-pinned) file when total exceeds budget.
  // Uses accurateTokens for the comparison. Pinned files are never dropped.
  let accurateTotal = budgetFiles.reduce((s, f) => s + f.accurateTokens, 0);
  while (accurateTotal > budget.effectiveBudget && budgetFiles.length > 0) {
    // Find last non-pinned file to drop (budgetFiles is in ranked order: highest score first)
    let dropIdx = budgetFiles.length - 1;
    while (dropIdx >= 0 && pinnedSet.has(budgetFiles[dropIdx].path)) {
      dropIdx--;
    }
    if (dropIdx < 0) break; // all remaining files are pinned; can't drop any
    const [dropped] = budgetFiles.splice(dropIdx, 1);
    excluded.push({ path: dropped.path, reason: 'exceeds-budget' });
    accurateTotal -= dropped.accurateTokens;
  }

  return { included: budgetFiles, excluded };
}
