import type { LLMProvider } from '../compression/providers/types.js';
import type { EmbeddingCache } from './embeddingCache.js';

function cosine(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function semanticScore(
  query: string,
  texts: string[],
  provider: LLMProvider,
  cache: EmbeddingCache,
): Promise<number[]> {
  if (!provider.embed) return texts.map(() => 0);

  // Fetch embeddings for uncached texts
  const uncachedIdxs: number[] = [];
  const cached = texts.map((t, i) => {
    const v = cache.get(t);
    if (!v) uncachedIdxs.push(i);
    return v;
  });

  if (uncachedIdxs.length > 0) {
    const toEmbed = [query, ...uncachedIdxs.map(i => texts[i])];
    const vecs = await provider.embed(toEmbed);
    const queryVec = vecs[0];
    cache.set(query, queryVec);
    uncachedIdxs.forEach((idx, j) => { cache.set(texts[idx], vecs[j + 1]); });
    cache.save();

    // Also need query embedding cached
    const queryVecCached = cache.get(query) ?? queryVec;
    return texts.map((t, i) => {
      const v = cached[i] ?? cache.get(t);
      return v ? cosine(queryVecCached, v) : 0;
    });
  }

  const queryVec = cache.get(query);
  if (!queryVec) return texts.map(() => 0);
  return texts.map(t => { const v = cache.get(t); return v ? cosine(queryVec, v) : 0; });
}
