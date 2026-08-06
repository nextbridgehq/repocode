import fs from 'fs';
import type { RankedFile, QueryConfig } from '../types.js';
import type { LLMProvider } from '../compression/providers/types.js';
import { tokenize } from './tokenizer.js';
import { buildTFIDF, scoreQuery } from './tfidf.js';
import { locationBoost } from './locationBoost.js';
import { EmbeddingCache } from './embeddingCache.js';
import { semanticScore } from './semanticScorer.js';

function normalize(scores: number[]): number[] {
  const max = Math.max(scores.reduce((m, s) => s > m ? s : m, 0), 1e-9);
  return scores.map(s => s / max);
}

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

  return files
    .map((f, i) => ({ ...f, score: f.score * (1 + normScores[i]) }))
    .sort((a, b) => b.score - a.score);
}
