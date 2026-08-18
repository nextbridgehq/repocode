import type { DiscoveredFile, RankedFile, ExcludedFile, RankingConfig, CompressionLevel, CompressConfig } from '../types.js';
import {
  structuralScore, depthScore, sizeScore,
  extensionScore, keywordScore, recencyScore,
} from './signals.js';

const WEIGHTS = {
  structural: 0.25, depth: 0.20, size: 0.15,
  extension: 0.15, keyword: 0.15, recency: 0.10,
} as const;

export function rankPass1(
  files: DiscoveredFile[],
  config: RankingConfig
): RankedFile[] {
  const maxSize = Math.max(...files.map(f => f.size), 1);
  const now = Date.now();

  return files
    .map(f => {
      const signals = {
        structural: structuralScore(f.path),
        depth:      depthScore(f.path),
        size:       sizeScore(f.size, maxSize),
        extension:  extensionScore(f.path),
        keyword:    keywordScore(f.path, config.keywords),
        recency:    recencyScore(f.mtime, now),
      };
      let score =
        signals.structural * WEIGHTS.structural +
        signals.depth      * WEIGHTS.depth +
        signals.size       * WEIGHTS.size +
        signals.extension  * WEIGHTS.extension +
        signals.keyword    * WEIGHTS.keyword +
        signals.recency    * WEIGHTS.recency;

      if (f.source === 'git-dep')                           score *= 0.7;
      if (f.source === 'git-changed' && f.tracked === false) score *= 0.85;

      return { ...f, score, signalScores: signals };
    })
    // Ties are common (sizeScore saturates near 1.0 for most files), and a stable sort would
    // leave them ordered by discovery order. Break ties on path so ranking depends only on
    // the file set, never on the order it arrived in.
    .sort((a, b) => (b.score - a.score) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Candidates to consider, as a multiple of how many median-sized files would fit in the
 *  budget *uncompressed*.
 *
 *  These used to run 2.5-6.0, on the premise that compression lets us usefully carry several
 *  times more files than would otherwise fit. Measured, that premise fails: at ~5x the fitter
 *  admits ~300 files and upgrades almost none, so gold files arrive as signatures retaining
 *  ~11% of their content — present in the output, useless for the task. Recall measured on
 *  delivered content peaks below 1.0 and collapses to zero above ~2x.
 *
 *  Below 1.0 means "consider fewer files than would fit whole", which leaves the fitter
 *  headroom to include larger-than-median files intact rather than shaving everything down
 *  to fit one more entry. */
const COMPRESS_MULTIPLIER: Record<CompressionLevel, number> = {
  'none':             0.5,
  'tier1-regex':      0.6,
  'tier2-structural': 0.7,
  'tier3-llm':        0.8,
  'partial':          0.8,
};

function effectiveMultiplier(config: CompressConfig): number {
  if (typeof config === 'string') return COMPRESS_MULTIPLIER[config];
  // For selective config, use rest tier (most conservative estimate for candidate cut)
  const restLevel = config.rest ?? 'none';
  return COMPRESS_MULTIPLIER[restLevel];
}

export function selectCandidates(
  ranked: RankedFile[],
  effectiveBudget: number,
  pinned: string[],
  compress: CompressConfig = 'partial',
  maxCandidates?: number
): { candidates: RankedFile[]; dropped: ExcludedFile[] } {
  const pinnedSet = new Set(pinned);
  const pinnedFiles = ranked.filter(f => pinnedSet.has(f.path));
  const unpinned   = ranked.filter(f => !pinnedSet.has(f.path));

  const medianTokens = Math.max(median(unpinned.map(f => f.size / 4)), 1);
  // At least one candidate whenever there is anything to consider. The multipliers are below
  // 1.0, so a budget smaller than ~1.25 median files floors to zero — which would return an
  // empty pack and report every file as 'below-candidate-cut', hiding the real reason (the
  // file is simply larger than the budget) behind an artefact of rounding.
  let candidateCount = Math.min(
    unpinned.length,
    Math.max(
      unpinned.length > 0 ? 1 : 0,
      Math.floor((effectiveBudget / medianTokens) * effectiveMultiplier(compress)),
    )
  );

  if (maxCandidates !== undefined && candidateCount > maxCandidates) {
    candidateCount = maxCandidates;
  }

  const candidates = unpinned.slice(0, candidateCount);
  const dropped: ExcludedFile[] = unpinned.slice(candidateCount).map(f => ({
    path: f.path,
    reason: 'below-candidate-cut' as const,
  }));

  return { candidates: [...pinnedFiles, ...candidates], dropped };
}
