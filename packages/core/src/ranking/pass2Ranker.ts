import type { RankedFile } from '../types.js';

const DENSITY_WEIGHT = 0.7;
const CENTRALITY_WEIGHT = 0.3;

export function rankPass2(
  candidates: RankedFile[],
  pinned: string[],
  centralityMap?: Map<string, number>,
): RankedFile[] {
  const pinnedSet = new Set(pinned);
  const pinnedFiles = candidates.filter(f => pinnedSet.has(f.path));
  const unpinned   = candidates.filter(f => !pinnedSet.has(f.path));

  if (unpinned.length === 0) return [...pinnedFiles];

  // Compute raw density: score / estimated_tokens
  const rawDensities = unpinned.map(f => f.score / Math.max(1, f.size / 4));
  const maxDensity = Math.max(...rawDensities);

  // Guard: if all densities are zero, return original order unchanged
  if (maxDensity === 0) return [...pinnedFiles, ...unpinned];

  // Blend normalised density with in-degree centrality
  const withScore = unpinned.map((f, i) => {
    const normalizedDensity = rawDensities[i] / maxDensity;
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
