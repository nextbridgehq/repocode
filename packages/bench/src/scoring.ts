/**
 * Recall scoring.
 *
 * The first version of this benchmark scored a gold file as retrieved when its *path*
 * appeared in an arm's output. That is not the question the benchmark exists to answer.
 * Measured across 34 held-out instances, every single retrieval repocode made was a
 * `tier2-structural` or `partial` stub retaining ~11% of the file — function bodies stripped,
 * signatures only. Those scored identically to a whole file.
 *
 * Worse, arms were not even scored on the same event: the naive arms charge a file's full
 * on-disk size against the budget, so their hits were whole files, while the compressing arms
 * charged only the fragment they kept. The comparison credited compressed fragments against
 * whole files.
 *
 * So retrieval is defined here in terms of content actually delivered, measured in characters
 * so it is independent of any arm's token estimator, and applied identically to every arm.
 */

export interface Retrieval {
  path: string;
  /** Characters of this file's content actually present in the arm's output. */
  chars: number;
  /** The delivered text, when the arm has it. Absent for an arm that delivers whole files. */
  content?: string;
}

export interface RecallResult {
  found: number;
  total: number;
  pct: number;
  /** Per-gold-file share of the original that survived, for diagnosis. */
  retentions: Record<string, number>;
}

/**
 * @param originalChars size of the file as it exists on disk; 0 for a file that is missing.
 * @param minRetention  share of the original a file must retain to count. 0 reproduces the
 *                      old path-only behaviour, which keeps historical numbers comparable.
 */
export function scoreRecall(
  goldFiles: string[],
  selected: Retrieval[],
  originalChars: (path: string) => number,
  minRetention: number,
): RecallResult {
  const byPath = new Map(selected.map(s => [s.path, s.chars]));
  const retentions: Record<string, number> = {};
  let found = 0;

  for (const gold of goldFiles) {
    const delivered = byPath.get(gold);
    if (delivered === undefined) {
      retentions[gold] = 0;
      continue;
    }
    const original = originalChars(gold);
    // An arm reporting more than the original means it is counting something other than the
    // file's content (wrapper markup, a double count). Cap rather than reward it.
    const retention = original > 0 ? Math.min(1, delivered / original) : (delivered > 0 ? 1 : 0);
    retentions[gold] = retention;
    if (retention >= minRetention) found++;
  }

  return {
    found,
    total: goldFiles.length,
    pct: goldFiles.length > 0 ? (found / goldFiles.length) * 100 : 100,
    retentions,
  };
}

/**
 * Hunk coverage: does the delivered content contain the lines the patch changes?
 *
 * Usable recall asks how much of a gold FILE arrived, which scores a pack that carries only the
 * patched function as a miss. Hunk coverage asks the question an agent cares about — is the code
 * it must edit in front of it — and works the same for whole files and excerpts.
 *
 * It is text-based: a hunk is represented by the lines it removes (or, when it only adds, the
 * context lines around the insertion) and counts as covered when most of them appear in the
 * delivered content. No line numbers, so it survives any excerpting scheme.
 */
export const HUNK_COVERED_SHARE = 0.8;

/** Lines shorter than this are punctuation or keywords (`}`, `else:`) that match by accident. */
const MIN_KEY_LINE = 4;

export function parsePatchHunks(patch: string): Record<string, string[][]> {
  const out: Record<string, string[][]> = {};
  let file: string | null = null;
  let removed: string[] = [];
  let context: string[] = [];
  let open = false;

  const close = () => {
    if (open && file) {
      const keys = (removed.length > 0 ? removed : context).filter(l => l.length > 0);
      if (keys.length > 0) (out[file] ??= []).push(keys);
    }
    removed = []; context = []; open = false;
  };

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) { close(); file = null; continue; }
    if (line.startsWith('+++ ')) {
      close();
      const p = line.slice(4).trim();
      file = p === '/dev/null' ? null : p.replace(/^b\//, '');
      continue;
    }
    if (line.startsWith('--- ')) { close(); continue; }
    if (line.startsWith('@@')) { close(); open = true; continue; }
    if (!open) continue;
    if (line.startsWith('-')) removed.push(line.slice(1).trim());
    else if (line.startsWith(' ')) context.push(line.trim());
  }
  close();
  return out;
}

/** How many of `hunks` have at least HUNK_COVERED_SHARE of their key lines present in `content`. */
export function scoreHunks(hunks: string[][], content: string): { covered: number; total: number } {
  const present = new Set(content.split('\n').map(l => l.trim()));
  let covered = 0;
  for (const hunk of hunks) {
    const keys = hunk.filter(l => l.length >= MIN_KEY_LINE);
    const use = keys.length > 0 ? keys : hunk;
    const hit = use.filter(l => present.has(l)).length;
    if (use.length > 0 && hit / use.length >= HUNK_COVERED_SHARE) covered++;
  }
  return { covered, total: hunks.length };
}
