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

  return files
    .map(f => {
      const signals = {
        structural: structuralScore(f.path),
        depth:      depthScore(f.path),
        size:       sizeScore(f.size, maxSize),
        extension:  extensionScore(f.path),
        keyword:    keywordScore(f.path, config.keywords),
        recency:    recencyScore(f.mtime),
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
    .sort((a, b) => b.score - a.score);
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

const COMPRESS_MULTIPLIER: Record<CompressionLevel, number> = {
  'none':             1.2,
  'tier1-regex':      2.0,
  'tier2-structural': 2.5,
  'tier3-llm':        4.0,
  'partial':          3.0,
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
  let candidateCount = Math.min(
    unpinned.length,
    Math.floor((effectiveBudget / medianTokens) * effectiveMultiplier(compress))
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
