import { tokenize } from './tokenizer.js';

/** Okapi BM25. Replaces max-normalised TF-IDF, which let a changelog or a term-stuffed fixture
 *  outscore the file a fix touches: term frequency grew without bound and long documents were
 *  never discounted. */
const K1 = 1.2;
const B = 0.75;

export interface BM25Index {
  tf: Map<string, Map<string, number>>;  // docPath -> term -> raw count
  len: Map<string, number>;              // docPath -> term count
  avgLen: number;
  idf: Map<string, number>;              // term -> idf, always > 0
}

export function buildBM25(corpus: Array<{ path: string; text: string }>): BM25Index {
  const tf = new Map<string, Map<string, number>>();
  const len = new Map<string, number>();
  const df = new Map<string, number>();
  let total = 0;

  for (const { path, text } of corpus) {
    const terms = tokenize(text);
    const counts = new Map<string, number>();
    for (const t of terms) counts.set(t, (counts.get(t) ?? 0) + 1);
    tf.set(path, counts);
    len.set(path, terms.length);
    total += terms.length;
    for (const t of counts.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const N = corpus.length;
  const idf = new Map<string, number>();
  // The "+1" form keeps idf positive for terms in more than half the documents.
  for (const [t, n] of df) idf.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5)));

  return { tf, len, avgLen: N ? total / N : 0, idf };
}

/** idf of a term that never occurs in the corpus: as rare as a term can be. */
export function idfOf(index: BM25Index, term: string): number {
  return index.idf.get(term) ?? Math.log(1 + (index.tf.size + 0.5) / 0.5);
}

/** `weight` scales a query term's contribution; terms it does not mention count 1. */
export function scoreBM25(
  queryTerms: string[],
  index: BM25Index,
  docPath: string,
  weight?: Map<string, number>,
): number {
  const counts = index.tf.get(docPath);
  if (!counts) return 0;
  const norm = K1 * (1 - B + B * (index.len.get(docPath) ?? 0) / (index.avgLen || 1));
  let score = 0;
  for (const t of new Set(queryTerms)) {
    const f = counts.get(t);
    if (!f) continue;
    score += (weight?.get(t) ?? 1) * (index.idf.get(t) ?? 0) * (f * (K1 + 1)) / (f + norm);
  }
  return score;
}

/** Document frequency of a term as a fraction of the corpus. */
export function dfFraction(index: BM25Index, term: string): number {
  let n = 0;
  for (const counts of index.tf.values()) if (counts.has(term)) n++;
  return index.tf.size ? n / index.tf.size : 0;
}
