import type { RankedFile } from '../types.js';

export interface NeighborBoostOptions {
  pinned: string[];
  /** How many of the top-ranked files act as seeds. */
  seeds: number;
  /** Share of a seed's score handed to each file one import away from it. */
  beta: number;
}

/** Seeds and strength chosen on 274 SWE-bench Lite instances. 12 seeds at 0.10 put the gold file in
 *  the top 12 for 8 more whole-issue instances (and 1 fewer), 9 more for the title query (2 fewer),
 *  and raised the top-20 share from 84.3% to 88.0% (whole issue). 0.35 lost 13-40 instances
 *  from the top 12; fewer than 8 seeds did worse as well. */
export const NEIGHBOR_BOOST_DEFAULTS = { seeds: 12, beta: 0.1 } as const;

/**
 * The file a bug is in is often one import away from a file the query names strongly. Each file
 * that imports, or is imported by, one of the top-ranked files gets a share of that seed's score
 * (the best one, not the sum, so a hub next to many seeds does not run away). Only first-degree
 * neighbours qualify. Pinned files keep the front and never act as seeds.
 *
 * `imports` maps a root-relative path to the root-relative paths it imports.
 */
export function neighborBoost(
  files: RankedFile[],
  imports: Record<string, string[]>,
  options: NeighborBoostOptions,
): RankedFile[] {
  const pinnedSet = new Set(options.pinned);
  const pinnedFiles = files.filter(f => pinnedSet.has(f.path));
  const rest = files.filter(f => !pinnedSet.has(f.path));
  if (rest.length === 0 || options.seeds <= 0 || options.beta <= 0) return [...pinnedFiles, ...rest];

  const neighbours = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = neighbours.get(a);
    if (list) list.push(b); else neighbours.set(a, [b]);
  };
  for (const [from, deps] of Object.entries(imports)) {
    for (const to of deps) { link(from, to); link(to, from); }
  }

  const boost = new Map<string, number>();
  for (const seed of rest.slice(0, options.seeds)) {
    for (const n of neighbours.get(seed.path) ?? []) {
      boost.set(n, Math.max(boost.get(n) ?? 0, seed.score));
    }
  }

  const boosted = rest
    .map(f => ({ ...f, score: f.score + options.beta * (boost.get(f.path) ?? 0) }))
    // Ties are broken on path, so the order depends only on the file set, never on arrival order.
    .sort((a, b) => (b.score - a.score) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return [...pinnedFiles, ...boosted];
}
