import type { RankedFile } from '../types.js';

const CENTRALITY_WEIGHT = 0.3;

/** Centrality weight when the input is already query-ranked. Import centrality is a query-blind
 *  signal; at 0.3 it put vendored chardet/urllib3 files (no query match, centrality 0.6-1.0)
 *  above sessions.py in psf/requests. Measured on 158 SWE-bench Lite instances, 0.15 raised
 *  R@5 from 39% to 45% and MRR from 0.198 to 0.311, at a 2-point cost to R@50. */
const QUERY_CENTRALITY_WEIGHT = 0.15;

/** Raw density of a file: pass-1 score per estimated token. Bounded by 1 because score <= 1
 *  and the divisor is clamped at 1. */
function rawDensity(f: RankedFile): number {
  return f.score / Math.max(1, f.size / 4);
}

/** Density scale for a whole file set, to be handed to `rankPass2` as `densityScale`.
 *  Compute this once over every ranked file — not over the candidate subset — so the
 *  ranking does not shift when the candidate cut changes size. */
export function densityScaleFor(files: RankedFile[]): number {
  return files.length === 0 ? 0 : Math.max(...files.map(rawDensity));
}

/** `useDensity: false` is for query-reranked input. The query score already says which files
 *  matter; dividing it by size let an empty file beat the file a query had ranked 13th
 *  (measured: rank 13 → 509 on pytest-dev__pytest-11143). The budget fitter, not the ranking,
 *  decides whether a large file fits. */
export function rankPass2(
  candidates: RankedFile[],
  pinned: string[],
  centralityMap?: Map<string, number>,
  densityScale?: number,
  useDensity = true,
): RankedFile[] {
  const pinnedSet = new Set(pinned);
  const pinnedFiles = candidates.filter(f => pinnedSet.has(f.path));
  const unpinned   = candidates.filter(f => !pinnedSet.has(f.path));

  if (unpinned.length === 0) return [...pinnedFiles];

  // Scores are already in [0, 1] and are per-file, so no set-wide scale is involved and a
  // growing candidate set cannot reorder existing files.
  if (!useDensity) return [...pinnedFiles, ...sortBlended(unpinned.map(f => f.score), unpinned, centralityMap, QUERY_CENTRALITY_WEIGHT)];

  const rawDensities = unpinned.map(rawDensity);

  // Normalising by the set's own maximum makes the blend below depend on which files are
  // in `candidates`: a denser file joining the set rescales every density but leaves
  // centrality untouched, which silently reorders files that did not themselves change.
  // Callers that cut a candidate set by budget must pass a scale computed over the full
  // set, so a larger budget yields a superset rather than a different ordering.
  const scale = densityScale ?? Math.max(...rawDensities);

  // Guard: if all densities are zero, return original order unchanged
  if (scale === 0) return [...pinnedFiles, ...unpinned];

  return [...pinnedFiles, ...sortBlended(rawDensities.map(d => d / scale), unpinned, centralityMap)];
}

/** Blend a per-file base score in [0, 1] with in-degree centrality, then sort descending. */
function sortBlended(
  base: number[],
  files: RankedFile[],
  centralityMap?: Map<string, number>,
  centralityWeight = CENTRALITY_WEIGHT,
): RankedFile[] {
  const withScore = files.map((f, i) => {
    const centrality = centralityMap?.get(f.absolutePath) ?? 0;
    return { ...f, score: (1 - centralityWeight) * base[i] + centralityWeight * centrality };
  });

  // Stable sort: when scores differ by less than epsilon, preserve original order
  const EPSILON = 1e-10;
  withScore.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) < EPSILON) return 0; // preserve order
    return diff;
  });

  return withScore;
}
