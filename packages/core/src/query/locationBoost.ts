import { tokenize } from './tokenizer.js';

/** A line that declares a named symbol, in the languages the resolvers cover. Group 1 is the name. */
const DEFINITION = new RegExp(
  '^\\s*(?:export\\s+)?(?:default\\s+)?(?:pub(?:\\(\\w+\\))?\\s+)?(?:async\\s+)?(?:static\\s+)?' +
  '(?:def|class|function|fn|func|interface|struct|enum|trait|type|module|const|let|var)\\s+' +
  '(?:\\([^)]*\\)\\s*)?([A-Za-z_][A-Za-z0-9_]*)',
);
const IMPORT = /^\s*(?:import\s|from\s+\S+\s+import\s|use\s|require\(|#include\s|using\s)/;
const COMMENT = /^\s*(?:\/\/|#|\*|\/\*|""")/;

export interface LocationBoosts {
  boostFilename: number; boostExports: number; boostImports: number; boostComments: number;
}

/**
 * Structural evidence that a file is *about* the query's terms, not merely mentioning them.
 * Each term counts once per location type and is weighted by its idf, so a common word such as
 * "file" in a path is worth far less than a rare one such as "rewrite", and a long file cannot
 * accumulate score by repeating a term on many lines.
 *
 * `idf` must return a positive weight; `maxIdf` normalises it to at most 1 per term.
 */
export function locationBoost(
  content: string,
  filePath: string,
  queryTerms: string[],
  boosts: LocationBoosts,
  idf: (term: string) => number,
  maxIdf: number,
): number {
  const terms = new Set(queryTerms);
  if (terms.size === 0) return 0;
  const w = (t: string) => idf(t) / (maxIdf || 1);

  const slash = filePath.lastIndexOf('/');
  const base = new Set(tokenize(filePath.slice(slash + 1).replace(/\.[^.]+$/, '')));
  const dirs = new Set(tokenize(filePath.slice(0, slash + 1)));

  let score = 0;
  for (const t of terms) {
    if (base.has(t)) score += boosts.boostFilename * w(t);
    else if (dirs.has(t)) score += boosts.boostFilename * 0.3 * w(t);
  }

  const defined = new Set<string>();
  const imported = new Set<string>();
  const commented = new Set<string>();
  for (const line of content.split('\n')) {
    const def = DEFINITION.exec(line);
    const into = def ? defined : IMPORT.test(line) ? imported : COMMENT.test(line) ? commented : null;
    if (!into) continue;
    for (const t of tokenize(def ? def[1] : line)) if (terms.has(t)) into.add(t);
  }
  for (const t of defined) score += boosts.boostExports * w(t);
  for (const t of imported) score += boosts.boostImports * 0.5 * w(t);
  for (const t of commented) if (!defined.has(t)) score += boosts.boostComments * 0.5 * w(t);

  return score;
}

/** Repository paths the query names outright, either as a path (`sklearn/utils/validation.py`)
 *  or as a dotted module (`sklearn.utils.validation`). Returned as slash paths without extension. */
export function mentionedPaths(query: string): string[] {
  const out = new Set<string>();
  for (const m of query.match(/[A-Za-z0-9_][A-Za-z0-9_./-]*[/.][A-Za-z0-9_./-]*[A-Za-z0-9_]/g) ?? []) {
    const noExt = m.replace(/\.(py|pyi|ts|tsx|js|jsx|mjs|go|rs|rb|java|kt|cs|php|c|h|cc|cpp|hpp|swift)$/, '');
    const asPath = noExt.includes('/') ? noExt : noExt.replace(/\./g, '/');
    // A single dot is too often prose ("e.g", "v1.2") to treat as a module reference.
    if (asPath.split('/').filter(Boolean).length >= 2) out.add(asPath.replace(/^\.?\//, ''));
  }
  return [...out];
}

/** True when `filePath` is the file (or package `__init__`/`index`) a mention refers to. */
export function matchesMention(filePath: string, mention: string): boolean {
  const p = filePath.replace(/\.[^./]+$/, '');
  return p === mention || p.endsWith('/' + mention)
    || p === mention + '/__init__' || p.endsWith('/' + mention + '/__init__')
    || p === mention + '/index' || p.endsWith('/' + mention + '/index');
}
