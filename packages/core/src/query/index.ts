import fs from 'fs';
import type { RankedFile, QueryConfig } from '../types.js';
import type { LLMProvider } from '../compression/providers/types.js';
import { tokenize } from './tokenizer.js';
import { buildBM25, scoreBM25, idfOf, dfFraction } from './bm25.js';
import { locationBoost, mentionedPaths, matchesMention } from './locationBoost.js';
import { EmbeddingCache } from './embeddingCache.js';
import { semanticScore } from './semanticScorer.js';

/**
 * Saturating normalisation: s / (s + m), where m is the REFERENCE_QUANTILE score of the files
 * that matched.
 *
 * Dividing by the maximum let one outlier erase the signal: measured on a django instance,
 * the file the patch touched scored 1.05 against a repo maximum of 129.3 (a term-stuffed test
 * fixture), so it normalised to 0.008. The median is immune to a single outlier.
 *
 * Percentiles fixed that but threw magnitude away: the top few hundred matching files all
 * landed between 0.95 and 1.0, so a file the query named outright barely beat a weak match and
 * import centrality decided the order among them. Saturation keeps strong evidence strong —
 * a typical match scores 0.5, one ten times stronger 0.91 — while bounding every score below 1.
 *
 * The median was too low a reference. In a real repo nearly every file matches some common query
 * word, so half of all files scored 0.5 or more and the file defining the named symbol (0.67)
 * stood out little from vendored chardet files. Measured on 158 SWE-bench Lite instances, a 0.9
 * reference raised R@5 from 34% to 39% and MRR from 0.175 to 0.198; 0.75 gave 37% / 0.189.
 *
 * Files with no match stay at exactly 0 and are ranked by the prior alone.
 */
const REFERENCE_QUANTILE = 0.9;
function normalize(scores: number[]): number[] {
  const matched = scores.filter(s => s > 0).sort((a, b) => a - b);
  if (matched.length === 0) return scores.map(() => 0);
  const m = matched[Math.floor(matched.length * REFERENCE_QUANTILE)];
  return scores.map(s => (s > 0 ? s / (s + m) : 0));
}

/** How much of the final score the query accounts for, with the pass-1 prior taking the rest.
 *  The query has to dominate — it is the only signal that knows what the user is looking for —
 *  but not exclusively: ranking on the query alone measured worse than blending (gold at rank
 *  164 vs 79), because the prior still separates files the query cannot distinguish. */
const DEFAULT_QUERY_WEIGHT = 0.7;

/** Added to the raw score of a file the query names by path or module. Larger than any
 *  combination of text and location scores reaches in practice, so a named file leads. */
const MENTION_BOOST = 100;

/** Shaping for a query that has a body (see `rerank`): weight of a title term relative to a body
 *  term, the share of files above which a term is too common to help, and how many terms to keep. */
const TITLE_WEIGHT = 5;
const MAX_TERM_DF = 0.3;
const MAX_QUERY_TERMS = 40;

/** Changelogs and release notes mention nearly every identifier a fix ever touched, so they
 *  match almost any query; measured on pytest they ranked above the file the fix changed. */
const CHANGELOG = /(^|\/)(changelog|changes|history|news|release[-_ ]?notes)(\/|\.|$)/i;
const CHANGELOG_FACTOR = 0.2;

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

  // BM25 over file contents
  const corpus = files.map((f, i) => ({ path: f.path, text: contents[i] }));
  const bm25 = buildBM25(corpus);
  // A query with a body (a whole issue: title, then description) is mostly incidental words.
  // Weight the title, drop words common to many files, and keep the most distinctive terms.
  // Measured on 158 SWE-bench Lite instances with the whole issue as the query: R@10 51.9% -> 57.6%.
  let searchTerms = queryTerms;
  const termWeight = new Map<string, number>();
  const lines = query.split(/\r?\n/).filter(l => l.trim());
  if (lines.length > 1) {
    const title = new Set(tokenize(lines[0]));
    const uniq = [...new Set(queryTerms)].filter(t => dfFraction(bm25, t) <= MAX_TERM_DF);
    for (const t of uniq) termWeight.set(t, title.has(t) ? TITLE_WEIGHT : 1);
    uniq.sort((a, b) => termWeight.get(b)! * idfOf(bm25, b) - termWeight.get(a)! * idfOf(bm25, a));
    searchTerms = uniq.slice(0, MAX_QUERY_TERMS);
  }
  const textScores = files.map(f => scoreBM25(searchTerms, bm25, f.path, termWeight));

  // Where the terms occur: file name, definitions, imports, comments — weighted by rarity.
  const idf = (t: string) => idfOf(bm25, t);
  const maxIdf = Math.max(0, ...[...new Set(searchTerms)].map(idf));
  const locScores = files.map((f, i) =>
    locationBoost(contents[i], f.path, searchTerms, config, idf, maxIdf)
  );

  // A path or dotted module named in the query is the strongest evidence there is.
  const mentions = mentionedPaths(query);
  const mentionScores = files.map(f =>
    mentions.some(m => matchesMention(f.path, m)) ? MENTION_BOOST : 0
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

  const rawScores = files.map((f, i) =>
    (textScores[i] + locScores[i] + semScores[i]) * (CHANGELOG.test(f.path) ? CHANGELOG_FACTOR : 1)
    + mentionScores[i]
  );
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
