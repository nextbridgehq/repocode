import type { TUIFile } from '@repocode/core';

export type SortBy = 'rank' | 'name' | 'tokens';

export function filterAndSort(files: TUIFile[], filter: string, sortBy: SortBy): TUIFile[] {
  const q = filter.toLowerCase();
  const filtered = q ? files.filter(f => f.path.toLowerCase().includes(q)) : files;
  return [...filtered].sort((a, b) => {
    if (sortBy === 'rank')   return b.score - a.score;
    if (sortBy === 'name')   return a.path.localeCompare(b.path);
    if (sortBy === 'tokens') return b.tokens - a.tokens;
    return 0;
  });
}

export function computeDepFiles(
  files: TUIFile[],
  cursor: number,
  imports: Map<string, string[]>,
): Set<string> {
  const cursorFile = files[cursor];
  if (!cursorFile) return new Set();
  return new Set(imports.get(cursorFile.path) ?? []);
}

export function applyToggle(selected: Set<string>, filePath: string): Set<string> {
  const next = new Set(selected);
  if (next.has(filePath)) next.delete(filePath);
  else next.add(filePath);
  return next;
}

export function applySelectAll(selected: Set<string>, visible: TUIFile[]): Set<string> {
  const next = new Set(selected);
  visible.forEach(f => next.add(f.path));
  return next;
}

export function applyAddDeps(
  selected: Set<string>,
  cursorFile: TUIFile | undefined,
  imports: Map<string, string[]>,
  allPaths: Set<string>,
): Set<string> {
  if (!cursorFile) return selected;
  const next = new Set(selected);
  next.add(cursorFile.path);
  for (const dep of imports.get(cursorFile.path) ?? []) {
    if (allPaths.has(dep)) next.add(dep);
  }
  return next;
}

export function clampCursor(cursor: number, length: number): number {
  if (length === 0) return 0;
  return Math.max(0, Math.min(length - 1, cursor));
}
