import fs from 'fs';
import type { RankedFile, BudgetFile, ExcludedFile, TokenBudget, CompressionLevel, CompressConfig, SecurityMode } from '../types.js';
import { getCompressionTier } from '../types.js';
import { estimateFast } from '../tokens/fastEstimator.js';
import { estimateAccurateBatch } from '../tokens/accurateEstimator.js';
import { compressTier1, compressTier2 } from './compression.js';
import { buildFocus } from './focus.js';
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
  /** How leftover budget upgrades included files. 'breadth' (default) raises every file one
   *  step per pass, spreading fidelity evenly. 'depth' upgrades each file as far as it will go,
   *  in rank order, so the highest-ranked files arrive whole — right when the ranking reflects a
   *  query, where the top files are the ones the task needs. Neither changes which files are
   *  included. */
  upgradeOrder?: 'breadth' | 'depth';
  /** Fraction of the budget held back from admission, for 'depth' upgrades. Admission fills
   *  the budget with every file's cheapest representation, so without a reserve the top-ranked
   *  files have no headroom to be upgraded into (measured: the gold file ranked 1st at 10.8% of
   *  its content). Admission stops at `(1 - reserve) * budget`, a cut that depends only on rank
   *  and budget, so a larger budget still includes a superset of files. Ignored for 'breadth'. */
  upgradeReserve?: number;
  /** The task query. When set, large files near the top of the ranking also get 'focus'
   *  representations: signatures plus the bodies of the symbols the query is about. They sit between
   *  the whole file and the signature-only skeleton, so only the upgrade step uses them and the set
   *  of included files is unchanged. */
  focusQuery?: string;
}

/** Minimum remaining budget (tokens) below which we stop fitting more files.
 *  Only applies when effectiveBudget itself is >= this value, so tests with
 *  tiny budgets are unaffected. Pinned files are always processed. */
const MIN_USEFUL_REMAINING_TOKENS = 200;

const LEVEL_ORDER: CompressionLevel[] = ['none', 'tier1-regex', 'focus', 'tier2-structural', 'tier3-llm', 'partial'];

/** Only the files at the top of the ranking are worth parsing, and only when whole they are costly. */
const FOCUS_TOP_K = 30;
/** A top-ranked file whose whole text costs more than this share of the budget is upgraded to whole
 *  only after every other file has been upgraded. */
const RANK1_WHOLE_SHARE = 0.6;
const FOCUS_MIN_TOKENS = 1500;

/** Richest first; within a level (several focus steps) the larger one first. */
const byFidelity = (a: { level: CompressionLevel; tokens: number }, b: { level: CompressionLevel; tokens: number }) =>
  levelIndex(a.level) - levelIndex(b.level) || b.tokens - a.tokens;

function levelIndex(level: CompressionLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

export async function fitToBudget(
  candidates: RankedFile[],
  options: FitOptions,
  budget: TokenBudget,
): Promise<{ included: BudgetFile[]; excluded: ExcludedFile[] }> {
  const excluded: ExcludedFile[] = [];
  const pinnedSet = new Set(options.pinned);
  const processedPaths = new Set<string>();

  const reserve = options.upgradeOrder === 'depth' ? Math.min(Math.max(options.upgradeReserve ?? 0, 0), 0.9) : 0;
  // The reserve is held back from every file but the first: it exists to upgrade the top files,
  // so it must never keep the top file itself out.
  const holdBack = Math.floor(budget.effectiveBudget * reserve);
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

  // A file can be rendered at several compression levels; each is a (cost, fidelity) option
  // rather than a fallback only reached when the whole file will not fit.
  interface Repr { level: CompressionLevel; content: string; tokens: number }

  /** Every representation `file` is allowed to take, ordered by fidelity — richest ('none')
   *  first. Cost is tracked separately because a cheaper representation is not always a more
   *  compressed one: on small files several tiers collapse to the same token count, and
   *  ordering by cost would make "upgrade" walk into heavier compression for no saving. */
  function buildReprs(content: string, file: RankedFile, ceiling: CompressionLevel): Repr[] {
    const reprs: Repr[] = [{ level: 'none', content, tokens: estimateFast(content) }];
    const maxLevel = levelIndex(ceiling);

    if (maxLevel >= levelIndex('tier1-regex')) {
      const t1 = compressTier1(content, file.language);
      reprs.push({ level: 'tier1-regex', content: t1, tokens: estimateFast(t1) });

      if (maxLevel >= levelIndex('tier2-structural')) {
        const t2 = compressTier2(t1, file.language);
        reprs.push({ level: 'tier2-structural', content: t2, tokens: estimateFast(t2) });

        if (maxLevel >= levelIndex('partial')) {
          const partial = extractPartial(t2, file.language, file.hunks);
          reprs.push({ level: 'partial', content: partial, tokens: estimateFast(partial) });
        }
      }
    }

    return reprs.sort(byFidelity);
  }

  /** Index of the cheapest representation. Ties resolve to the richest, since `reprs` runs
   *  richest first and only a strict improvement moves the choice. */
  function cheapestIndex(reprs: Repr[]): number {
    let best = 0;
    for (let i = 1; i < reprs.length; i++) {
      if (reprs[i].tokens < reprs[best].tokens) best = i;
    }
    return best;
  }

  // Phase 2: admit files at their cheapest allowed representation.
  //
  // Selection cost must not depend on how much budget happens to be left when a file is
  // reached. Choosing "whole file if it currently fits" made a file's cost a function of the
  // budget, so raising the budget let a large file in whole — swallowing many times what the
  // increase provided and evicting files a smaller budget had comfortably included. Admitting
  // everything at a fixed, cheap cost makes the set of included files depend only on rank, so
  // a larger budget can add files but never lose them.
  type Selection = { file: RankedFile; reprs: Repr[]; reprIndex: number; rankPosition: number };
  const selected: Selection[] = [];
  let rankPosition = 0;

  for (const { file, content, error } of readResults) {
    const isPinned = pinnedSet.has(file.path);

    // Early exit: remaining budget too small to be useful.
    if (remaining - (rankPosition === 0 ? 0 : holdBack) < MIN_USEFUL_REMAINING_TOKENS && budget.effectiveBudget >= MIN_USEFUL_REMAINING_TOKENS && !isPinned) break;
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

    // Pinned files always use the full ceiling regardless of options.compress
    const ceiling = isPinned ? 'partial' : getCompressionTier(rankPosition, options.compress);
    const reprs = buildReprs(content, file, ceiling);

    // Focus only drops bodies, so it needs a ceiling that already allows skeletons.
    if (options.focusQuery && rankPosition <= FOCUS_TOP_K && levelIndex(ceiling) >= levelIndex('tier2-structural')) {
      const whole = reprs.find(r => r.level === 'none')!;
      if (whole.tokens > FOCUS_MIN_TOKENS) {
        const tier2 = reprs.find(r => r.level === 'tier2-structural');
        for (const text of (await buildFocus(content, file.path, options.focusQuery)) ?? []) {
          const tokens = estimateFast(text);
          if (tokens < whole.tokens && (!tier2 || tokens > tier2.tokens)) reprs.push({ level: 'focus', content: text, tokens });
        }
        reprs.sort(byFidelity);
      }
    }

    // Tier 3 costs real API spend, so it is never computed speculatively — only for a file
    // that will not fit even at its cheapest local representation.
    if (reprs[cheapestIndex(reprs)].tokens > remaining - (rankPosition === 1 ? 0 : holdBack)
        && levelIndex(ceiling) >= levelIndex('tier3-llm') && options.llmProvider) {
      const base = reprs.find(r => r.level === 'tier2-structural') ?? reprs[0];
      // Pre-redact secrets before sending to LLM and before caching the hash.
      // Redaction happens after tier2 so compressors operate on clean code.
      let t3Input = base.content;
      if (options.securityMode === 'redact') {
        const scan = await scanForSecrets(file.path, t3Input, 'redact');
        if (scan.redactedContent) {
          t3Input = scan.redactedContent;
        }
      }
      const { llmCompress } = await import('../compression/llmCompressor.js');
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
      // llmCompress returns its input unchanged when the cost guard trips
      if (t3 !== t3Input) {
        reprs.push({ level: 'tier3-llm', content: t3, tokens: estimateFast(t3) });
        reprs.sort((a, b) => levelIndex(a.level) - levelIndex(b.level));
      }
    }

    const startIndex = cheapestIndex(reprs);
    if (reprs[startIndex].tokens <= remaining - (isPinned || rankPosition === 1 ? 0 : holdBack)) {
      selected.push({ file, reprs, reprIndex: startIndex, rankPosition });
      remaining -= reprs[startIndex].tokens;
    } else if (isPinned) {
      // Pinned force-include — whole file regardless of budget
      const whole = reprs.findIndex(r => r.level === 'none');
      selected.push({ file, reprs, reprIndex: whole, rankPosition });
      remaining -= reprs[whole].tokens;
    } else {
      excluded.push({
        path: file.path,
        reason: levelIndex(ceiling) > levelIndex('none')
          ? 'exceeds-budget-after-compression'
          : 'exceeds-budget',
      });
    }
  }

  // Phase 3: spend what is left upgrading files toward richer representations. One step per
  // file per pass, in rank order, so leftover budget spreads across the selection instead of
  // the highest-ranked file absorbing all of it. Upgrades never evict, so the included set is
  // still exactly what phase 2 chose.
  // Files not reached due to early exit
  for (const file of ordered) {
    if (!processedPaths.has(file.path)) {
      excluded.push({ path: file.path, reason: 'exceeds-budget' });
    }
  }

  // Accurate token counts. tiktoken can only measure what is on disk, so it applies to the
  // uncompressed representation; compressed ones keep the fast estimate made while fitting.
  const accurateMap = await estimateAccurateBatch(
    selected.map(e => e.file.absolutePath),
    options.cache,
    options.root,
  );
  const accurateFor = (entry: Selection, index: number): number => {
    const repr = entry.reprs[index];
    return repr.level === 'none'
      ? accurateMap.get(entry.file.absolutePath) ?? repr.tokens
      : repr.tokens;
  };

  // Correction loop: drop lowest-ranked (non-pinned) file when the accurate total exceeds
  // budget. Runs on the base selection, before any upgrade is applied, so that the set of
  // included files is settled purely by rank and cheapest cost. Pinned files are never
  // dropped.
  let accurateTotal = selected.reduce((s, e) => s + accurateFor(e, e.reprIndex), 0);
  while (accurateTotal > budget.effectiveBudget && selected.length > 0) {
    let dropIdx = selected.length - 1; // selected is in ranked order: highest score first
    while (dropIdx >= 0 && pinnedSet.has(selected[dropIdx].file.path)) {
      dropIdx--;
    }
    if (dropIdx < 0) break; // all remaining files are pinned; can't drop any
    const [dropped] = selected.splice(dropIdx, 1);
    excluded.push({ path: dropped.file.path, reason: 'exceeds-budget' });
    accurateTotal -= accurateFor(dropped, dropped.reprIndex);
  }

  // Phase 3: spend what is left upgrading files toward richer representations. One step per
  // file per pass, in rank order, so leftover budget spreads across the selection instead of
  // the highest-ranked file absorbing all of it. This runs after the correction loop and
  // measures upgrades in accurate tokens, so an upgrade can never push the total over budget
  // and evict a file that the smaller budget had comfortably included.
  let headroom = budget.effectiveBudget - accurateTotal;
  if (options.upgradeOrder === 'depth') {
    // Jump straight to the richest representation that fits. Stepping one level at a time would
    // stop at the first step that does not fit, even when a richer one costs less (tier3 can
    // be cheaper than tier2).
    const deepen = (entry: Selection, allowFocus: boolean) => {
      for (let next = 0; next < entry.reprIndex; next++) {
        if (!allowFocus && entry.reprs[next].level === 'focus') continue;
        if (entry === deferred && !finalPass && entry.reprs[next].tokens >= deferredWholeTokens * 0.9) continue;
        const delta = accurateFor(entry, next) - accurateFor(entry, entry.reprIndex);
        if (delta <= headroom) {
          headroom -= delta;
          entry.reprIndex = next;
          break;
        }
      }
    };
    // With a query, a top-ranked file that would take most of the budget whole goes last: when it is
    // the wrong file, whole delivery starved the gold file ranked below it (matplotlib). It still
    // gets focus first and goes whole from whatever the others leave.
    const top = selected[0];
    const topWhole = top?.reprs.find(r => r.level === 'none');
    const deferred = options.focusQuery && top?.rankPosition === 1 && top.reprs.some(r => r.level === 'focus')
      && topWhole && accurateFor(top, top.reprs.indexOf(topWhole)) > budget.effectiveBudget * RANK1_WHOLE_SHARE
      ? top : null;
    // Tier 1 often costs the same as the whole file, so "whole" here means any representation near it.
    const deferredWholeTokens = deferred?.reprs.find(r => r.level === 'none')?.tokens ?? 0;
    let finalPass = false;
    // 1. Everything that exists without focus, in rank order: exactly what a run without focus
    //    delivers. Focus must only spend what this leaves — benchmark: six instances lost a whole
    //    gold file because focus steps for the file above it were taken first.
    for (const entry of selected) deepen(entry, false);
    // 2. Every file gets its smallest focus step before any file takes a bigger one. Taking each
    //    file to its richest step in rank order let one large focus drain the leftover and left the
    //    file ranked just below it a bare skeleton (matplotlib-25332: gold file at 9% while the
    //    file above it took 9k tokens of extra bodies).
    for (const entry of selected) {
      const floor = entry.reprs.map(r => r.level).lastIndexOf('focus');
      if (floor < 0 || entry.reprIndex <= floor) continue;
      const delta = accurateFor(entry, floor) - accurateFor(entry, entry.reprIndex);
      if (delta <= headroom) {
        headroom -= delta;
        entry.reprIndex = floor;
      }
    }
    // 3. Bigger focus steps, in rank order.
    for (const entry of selected) deepen(entry, true);
    finalPass = true;
    if (deferred) deepen(deferred, true);
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const entry of selected) {
      const next = entry.reprIndex - 1; // reprs run richest first
      if (next < 0) continue;
      const delta = accurateFor(entry, next) - accurateFor(entry, entry.reprIndex);
      if (delta <= headroom) {
        headroom -= delta;
        entry.reprIndex = next;
        changed = true;
      }
    }
  }

  const budgetFiles: BudgetFile[] = selected.map(({ file, reprs, reprIndex, rankPosition: rank }) => {
    const repr = reprs[reprIndex];
    return {
      ...file,
      content: repr.content,
      tokens: repr.tokens,
      compressed: repr.level !== 'none',
      compressionLevel: repr.level,
      rankPosition: rank,
      accurateTokens: repr.level === 'none'
        ? accurateMap.get(file.absolutePath) ?? repr.tokens
        : repr.tokens,
    };
  });

  return { included: budgetFiles, excluded };
}
