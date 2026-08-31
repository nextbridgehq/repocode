import type { RankedFile } from '../types.js';

const DENSITY_WEIGHT = 0.7;
const CENTRALITY_WEIGHT = 0.3;

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

export function rankPass2(
  candidates: RankedFile[],
  pinned: string[],
  centralityMap?: Map<string, number>,
  densityScale?: number,
): RankedFile[] {
  const pinnedSet = new Set(pinned);
  const pinnedFiles = candidates.filter(f => pinnedSet.has(f.path));
  const unpinned   = candidates.filter(f => !pinnedSet.has(f.path));

  if (unpinned.length === 0) return [...pinnedFiles];

  const rawDensities = unpinned.map(rawDensity);

  // Normalising by the set's own maximum makes the blend below depend on which files are
  // in `candidates`: a denser file joining the set rescales every density but leaves
  // centrality untouched, which silently reorders files that did not themselves change.
  // Callers that cut a candidate set by budget must pass a scale computed over the full
  // set, so a larger budget yields a superset rather than a different ordering.
  const scale = densityScale ?? Math.max(...rawDensities);

  // Guard: if all densities are zero, return original order unchanged
  if (scale === 0) return [...pinnedFiles, ...unpinned];

  // Blend normalised density with in-degree centrality
  const withScore = unpinned.map((f, i) => {
    const normalizedDensity = rawDensities[i] / scale;
    const centrality = centralityMap?.get(f.absolutePath) ?? 0;
    return { ...f, score: DENSITY_WEIGHT * normalizedDensity + CENTRALITY_WEIGHT * centrality };
  });

  // Stable sort: when scores differ by less than epsilon, preserve original order
  const EPSILON = 1e-10;
  withScore.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) < EPSILON) return 0; // preserve order
    return diff;
  });

  return [...pinnedFiles, ...withScore];
}
