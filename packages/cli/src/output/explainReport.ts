import type { PackResult, RepoCodeConfig } from '@repocode/core';

/**
 * Machine-readable form of `--explain`.
 *
 * The human table goes to stderr and is for reading; this goes to stdout and is for diffing.
 * The point is that a ranking change becomes visible without re-running a benchmark: capture
 * this on two commits, diff, and every file whose rank, score, inclusion or compression tier
 * moved is listed. Several regressions in this project were only caught because someone
 * happened to check a specific instance — this makes that check mechanical.
 */
export interface ExplainedFile {
  path: string;
  /** Position in the final output, 1-based. */
  rank: number;
  score: number;
  signals: Record<string, number>;
  tokens: number;
  compressed: boolean;
  compressionLevel: string;
  /** Share of the file on disk that survived compression, 0..1, or null when unknown. */
  retained: number | null;
}

export interface ExplainReport {
  repository: string;
  budget: { maxTokens: number | null; effective: number | null };
  summary: {
    included: number;
    excluded: number;
    totalTokens: number;
    /** Counts keyed by compression level, so a shift toward stubs is visible at a glance. */
    byCompressionLevel: Record<string, number>;
  };
  included: ExplainedFile[];
  excluded: Array<{ path: string; reason: string }>;
}

export function buildExplainReport(result: PackResult, config: RepoCodeConfig): ExplainReport {
  const byCompressionLevel: Record<string, number> = {};
  for (const f of result.included) {
    const level = f.compressionLevel ?? 'none';
    byCompressionLevel[level] = (byCompressionLevel[level] ?? 0) + 1;
  }

  return {
    repository: config.root,
    budget: {
      maxTokens: config.budget.maxTokens,
      effective: result.budget?.effectiveBudget ?? null,
    },
    summary: {
      included: result.included.length,
      excluded: result.excluded.length,
      totalTokens: result.totalTokens,
      byCompressionLevel,
    },
    included: result.included.map((f, i) => ({
      path: f.path,
      rank: i + 1,
      score: round(f.score),
      signals: Object.fromEntries(
        Object.entries(f.signalScores ?? {}).map(([k, v]) => [k, round(v as number)]),
      ),
      tokens: f.accurateTokens,
      compressed: f.compressed,
      compressionLevel: f.compressionLevel ?? 'none',
      // Emitted characters over the file's size on disk. A retrieval that arrives as a 10%
      // signature is not the same as one that arrives whole, and the difference is invisible
      // from a file list alone.
      retained: f.size > 0 ? round(Math.min(1, (f.content?.length ?? 0) / f.size)) : null,
    })),
    excluded: result.excluded.map(e => ({ path: e.path, reason: e.reason })),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
