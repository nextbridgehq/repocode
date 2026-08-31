import type { SignalScores } from '@repocode/core';

export interface CompactExplainInput {
  totalTokens: number;
  outputTokens: number;
  budget: { maxTokens: number } | null;
  included: Array<{
    path: string;
    score: number;
    signalScores: SignalScores;
  }>;
  excluded: Array<{ path: string; reason: string }>;
}

// Mirrors the field order declared on core's SignalScores (packages/core/src/types.ts) — that
// order is now the tie-break rule. Order matters: dominantSignal only replaces its running best
// on a strictly greater score, so an earlier name in this list wins any tie.
const SIGNAL_ORDER = ['structural', 'depth', 'size', 'extension', 'keyword', 'recency'] as const;
type SignalName = (typeof SIGNAL_ORDER)[number];

function dominantSignal(signalScores: CompactExplainInput['included'][number]['signalScores']): SignalName {
  let best: SignalName = SIGNAL_ORDER[0];
  let bestValue = signalScores[best];
  for (const name of SIGNAL_ORDER.slice(1)) {
    const value = signalScores[name];
    if (value > bestValue) {
      best = name;
      bestValue = value;
    }
  }
  return best;
}

const INCLUDED_DISPLAY_CAP = 20;

export function formatCompactExplanation(task: string, result: CompactExplainInput): string {
  const lines: string[] = [];
  lines.push(`Task: "${task}"`);

  const budgetLine = result.budget
    ? `${result.outputTokens.toLocaleString()} / ${result.budget.maxTokens.toLocaleString()} tokens (${Math.round((result.outputTokens / result.budget.maxTokens) * 100)}%)`
    : `${result.outputTokens.toLocaleString()} tokens (no budget)`;
  lines.push(`Budget: ${budgetLine}`);

  lines.push('');
  lines.push(`Included (${result.included.length} files):`);
  const shownIncluded = result.included.slice(0, INCLUDED_DISPLAY_CAP);
  shownIncluded.forEach((file, i) => {
    const signal = dominantSignal(file.signalScores);
    lines.push(`${i + 1}. ${file.path} (score ${file.score.toFixed(2)}, top signal: ${signal})`);
  });
  if (result.included.length > INCLUDED_DISPLAY_CAP) {
    lines.push(`...and ${result.included.length - INCLUDED_DISPLAY_CAP} more.`);
  }

  if (result.excluded.length > 0) {
    const counts = new Map<string, number>();
    for (const ex of result.excluded) {
      counts.set(ex.reason, (counts.get(ex.reason) ?? 0) + 1);
    }
    const parts = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => `${count} ${reason}`);
    lines.push('');
    lines.push(`Excluded (${result.excluded.length} files): ${parts.join(', ')}`);
  }

  return lines.join('\n');
}
