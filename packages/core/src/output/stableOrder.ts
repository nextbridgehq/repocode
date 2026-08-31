import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

/**
 * Prompt-cache-stable output ordering.
 *
 * Ranking decides *which* files are packed. It should not decide *where* they appear, because
 * rank is unstable by design: editing one file changes its score, and if it was near the front
 * every file behind it shifts. Measured on a 40-file repo, editing a single file left two
 * consecutive packs sharing a 0% common prefix — an agent re-packing between turns re-sends
 * the entire context and caches nothing.
 *
 * So emission order is persisted and reused. Files whose content is unchanged keep the position
 * they held last time; files that are new *or whose content changed* go to the end. Moving
 * changed files matters as much as appending new ones: leaving an edited file in place keeps
 * the ordering stable but still breaks the byte prefix at that file, which is what a prompt
 * cache actually keys on.
 */

const ORDER_FILE = 'order.json';

export interface OrderEntry {
  path: string;
  /** Hash of the content emitted for this file last run. */
  hash: string;
}

export function hashContent(content: string): string {
  return createHash('sha1').update(content).digest('hex').slice(0, 16);
}

/**
 * Reorder `files` so unchanged ones keep their previous positions and everything new or edited
 * follows, in rank order.
 *
 * Always returns a fresh array. Callers reorder in place — clear the original, re-push from the
 * result — so returning the argument itself would empty both.
 */
export function applyStableOrder<T extends { path: string }>(
  files: T[],
  previous: OrderEntry[],
  hashOf: (file: T) => string,
): T[] {
  if (previous.length === 0) return [...files];

  const previousHash = new Map(previous.map(e => [e.path, e.hash]));
  const position = new Map(previous.map((e, i) => [e.path, i]));

  const unchanged: T[] = [];
  const moved: T[] = [];
  for (const file of files) {
    const before = previousHash.get(file.path);
    if (before !== undefined && before === hashOf(file)) unchanged.push(file);
    else moved.push(file);
  }
  unchanged.sort((a, b) => position.get(a.path)! - position.get(b.path)!);
  return [...unchanged, ...moved];
}

/**
 * The order to persist for next time.
 *
 * `knownPaths` is every file still present in the repository, not just those packed this run.
 * A file that exists but missed this budget keeps its slot, so when it returns it does not get
 * appended and push everything after it out of cache. Files that have left the repository are
 * forgotten, which bounds the file's growth.
 */
export function mergeOrder(
  previous: OrderEntry[],
  current: OrderEntry[],
  knownPaths: Set<string>,
): OrderEntry[] {
  const currentByPath = new Map(current.map(e => [e.path, e]));
  const seen = new Set<string>();
  const merged: OrderEntry[] = [];

  for (const entry of previous) {
    if (!knownPaths.has(entry.path) || seen.has(entry.path)) continue;
    // Prefer this run's hash where we have one; otherwise keep the slot with its old hash.
    merged.push(currentByPath.get(entry.path) ?? entry);
    seen.add(entry.path);
  }
  for (const entry of current) {
    if (!seen.has(entry.path)) { merged.push(entry); seen.add(entry.path); }
  }
  return merged;
}

function orderPath(root: string): string {
  return path.join(root, '.repocode', ORDER_FILE);
}

export function loadOrder(root: string): OrderEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(orderPath(root), 'utf-8'));
    if (!Array.isArray(parsed?.entries)) return [];
    return parsed.entries.filter(
      (e: unknown): e is OrderEntry =>
        !!e && typeof (e as OrderEntry).path === 'string' && typeof (e as OrderEntry).hash === 'string',
    );
  } catch {
    // Missing or unreadable: first run, or hand-edited. Rank order is a fine starting point —
    // stability only has to hold from the next pack onward.
    return [];
  }
}

export function saveOrder(root: string, entries: OrderEntry[]): void {
  try {
    const file = orderPath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ entries }, null, 0));
  } catch {
    // Ordering is an optimisation; a read-only checkout must still pack.
  }
}
