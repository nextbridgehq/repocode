import fs from 'fs';
import type { RankedFile, QueryConfig } from '../types.js';
import type { LLMProvider } from '../compression/providers/types.js';
import { tokenize } from './tokenizer.js';
import { buildTFIDF, scoreQuery } from './tfidf.js';
import { locationBoost } from './locationBoost.js';
import { EmbeddingCache } from './embeddingCache.js';
import { semanticScore } from './semanticScorer.js';

/**
 * Rank-based normalisation over the files that matched at all.
 *
 * Dividing by the maximum let one outlier erase the signal: measured on a django instance,
 * the file the patch touched scored 1.05 against a repo maximum of 129.3 (a term-stuffed test
 * fixture), so it normalised to 0.008 and the query changed its rank by 71 places out of 4771.
 * Percentiles depend on ordering rather than magnitude, so no single file can flatten the rest.
 *
 * Files with no match stay at exactly 0 — they are ranked by the prior alone. Including them
 * in the percentile population would hand a majority of irrelevant files a mid-range score.
 */
function normalize(scores: number[]): number[] {
  const n = scores.length;
  if (n === 0) return [];
  const sorted = [...scores].sort((a, b) => a - b);
  return scores.map(s => {
    // No match at all scores 0 and is ranked by the prior alone.
    if (s <= 0) return 0;
    // Share of *all* files scoring strictly less. Ranking within the matching subset instead
    // would understate a weak match: when 4000 of 4771 files match nothing, matching at all is
    // most of the signal, and a file low in the matched population is still far above the rest.
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < s) lo = mid + 1; else hi = mid;
    }
    return lo / n;
  });
}

/** How much of the final score the query accounts for, with the pass-1 prior taking the rest.
 *  The query has to dominate — it is the only signal that knows what the user is looking for —
 *  but not exclusively: ranking on the query alone measured worse than blending (gold at rank
 *  164 vs 79), because the prior still separates files the query cannot distinguish. */
const DEFAULT_QUERY_WEIGHT = 0.7;

export interface RerankOptions {
  /** Provider used for embeddings when config.mode === 'semantic'. */
  provider?: LLMProvider;
  /** Supply a cache to reuse it across the run and read its hit/miss counters
   *  afterwards. One is created internally when omitted. */
  embeddingCache?: EmbeddingCache;
}

export async function rerank(
  files: RankedFile[],
  query: string,
  config: QueryConfig,
  rootDir: string,
  options?: RerankOptions,
): Promise<RankedFile[]> {
  const provider = options?.provider;
  if (!query.trim()) return files;

  const queryTerms = tokenize(query);
  const contents: string[] = files.map(f => {
    try { return fs.readFileSync(f.absolutePath, 'utf-8'); } catch { return ''; }
  });

  // TF-IDF keyword scoring
  const corpus = files.map((f, i) => ({ path: f.path, text: contents[i] }));
  const tfidf = buildTFIDF(corpus);
  const tfScores = files.map(f => scoreQuery(query, tfidf, f.path));

  // Location boost
  const locScores = files.map((f, i) =>
    locationBoost(contents[i], f.path, queryTerms, config)
  );

  let semScores: number[] = files.map(() => 0);
  if (config.mode === 'semantic' && provider?.embed) {
    const cache = options?.embeddingCache ?? new EmbeddingCache(rootDir);
    const limited = files.slice(0, config.maxEmbedFiles);
    const limitedContents = contents.slice(0, config.maxEmbedFiles);
    semScores = await semanticScore(query, limitedContents, provider, cache);
    // Pad with zeros if fewer files were embedded
    while (semScores.length < files.length) semScores.push(0);
  }

  const rawScores = files.map((_, i) => tfScores[i] + locScores[i] + semScores[i]);
  const normScores = normalize(rawScores);

  // Blend, rather than multiply. `score * (1 + q)` capped the query's influence at 2x, which a
  // file only had to be named LICENSE or README to survive — structuralScore hands those 1.0
  // whether or not they have anything to do with the task. Both terms are in [0, 1], so they
  // are directly comparable.
  const weight = config.queryWeight ?? DEFAULT_QUERY_WEIGHT;
  return files
    .map((f, i) => ({ ...f, score: weight * normScores[i] + (1 - weight) * f.score }))
    .sort((a, b) => (b.score - a.score) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
