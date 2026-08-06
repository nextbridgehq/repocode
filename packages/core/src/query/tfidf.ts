import { tokenize } from './tokenizer.js';

export interface TFIDFIndex {
  tf: Map<string, Map<string, number>>;  // docPath -> term -> tf
  idf: Map<string, number>;              // term -> idf
}

export function buildTFIDF(corpus: Array<{ path: string; text: string }>): TFIDFIndex {
  const tf = new Map<string, Map<string, number>>();
  const df = new Map<string, number>();
  const N = corpus.length;

  for (const { path, text } of corpus) {
    const terms = tokenize(text);
    const counts = new Map<string, number>();
    for (const t of terms) counts.set(t, (counts.get(t) ?? 0) + 1);
    const maxCount = Math.max(...counts.values(), 1);
    const normCounts = new Map<string, number>();
    for (const [t, c] of counts) normCounts.set(t, c / maxCount);
    tf.set(path, normCounts);
    for (const t of counts.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const idf = new Map<string, number>();
  for (const [t, freq] of df) idf.set(t, Math.log((N + 1) / (freq + 1)) + 1);

  return { tf, idf };
}

export function scoreQuery(query: string, index: TFIDFIndex, docPath: string): number {
  const terms = tokenize(query);
  const docTF = index.tf.get(docPath);
  if (!docTF) return 0;
  return terms.reduce((sum, t) => {
    return sum + (docTF.get(t) ?? 0) * (index.idf.get(t) ?? 0);
  }, 0);
}
