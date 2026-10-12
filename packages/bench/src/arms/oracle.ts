import type { Retrieval } from '../scoring.js';

/**
 * The perfect ranker: it already knows which files the patch touches.
 *
 * This arm exists to falsify the harness rather than to compete. If the oracle does not score
 * 100%, the gold paths, the extraction, or the recall comparison is broken — and no result
 * from any other arm means anything until that is fixed. Without it, a harness bug and a
 * ranking failure are indistinguishable, which is exactly how a truncated tree and a bad
 * candidate cut got confused for each other.
 *
 * It delivers each file whole, so it also anchors the top of the fidelity scale: an arm that
 * cannot match the oracle's retention is returning less of the file than exists on disk.
 */
export function runOracle(
  goldFiles: string[],
  budgetTokens: number,
  sizeOf: (path: string) => number,
): Retrieval[] {
  const selected: Retrieval[] = [];
  let used = 0;
  for (const file of goldFiles) {
    const chars = sizeOf(file);
    // Floor at 1 token so a zero-cost estimate cannot make an empty budget look sufficient.
    const cost = Math.max(1, Math.ceil(chars / 3.5));
    if (used + cost > budgetTokens) break;
    used += cost;
    selected.push({ path: file, chars });
  }
  return selected;
}
