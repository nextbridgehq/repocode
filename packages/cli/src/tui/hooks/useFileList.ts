import { useState, useMemo, useCallback } from 'react';
import type { TUIFile } from '@repocode/core';
import {
  filterAndSort, computeDepFiles, applyToggle,
  applySelectAll, applyAddDeps, clampCursor,
  type SortBy,
} from '../fileListUtils.js';

export type { SortBy };

const SORT_CYCLE: SortBy[] = ['rank', 'name', 'tokens'];

export interface UseFileListResult {
  filteredFiles: TUIFile[];
  cursor: number;
  depFiles: Set<string>;
  selected: Set<string>;
  sortBy: SortBy;
  moveCursor: (delta: number) => void;
  toggleCursor: () => void;
  selectAllVisible: () => void;
  deselectAll: () => void;
  addDepsOfCursor: () => void;
  cycleSortBy: () => void;
  setSelected: (s: Set<string>) => void;
}

export function useFileList(
  allFiles: TUIFile[],
  imports: Map<string, string[]>,
  filter: string,
): UseFileListResult {
  const [cursor, setCursor]   = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy]   = useState<SortBy>('rank');

  const filteredFiles = useMemo(
    () => filterAndSort(allFiles, filter, sortBy),
    [allFiles, filter, sortBy],
  );

  const clamped = clampCursor(cursor, filteredFiles.length);

  const depFiles = useMemo(
    () => computeDepFiles(filteredFiles, clamped, imports),
    [filteredFiles, clamped, imports],
  );

  const moveCursor = useCallback(
    (delta: number) => setCursor(c => clampCursor(c + delta, filteredFiles.length)),
    [filteredFiles.length],
  );

  const toggleCursor = useCallback(
    () => setSelected(prev => applyToggle(prev, filteredFiles[clamped]?.path ?? '')),
    [filteredFiles, clamped],
  );

  const selectAllVisible = useCallback(
    () => setSelected(prev => applySelectAll(prev, filteredFiles)),
    [filteredFiles],
  );

  const deselectAll = useCallback(() => setSelected(new Set()), []);

  const allPaths = useMemo(() => new Set(allFiles.map(f => f.path)), [allFiles]);

  const addDepsOfCursor = useCallback(
    () => setSelected(prev => applyAddDeps(prev, filteredFiles[clamped], imports, allPaths)),
    [filteredFiles, clamped, imports, allPaths],
  );

  const cycleSortBy = useCallback(() => {
    setCursor(0);
    setSortBy(prev => SORT_CYCLE[(SORT_CYCLE.indexOf(prev) + 1) % SORT_CYCLE.length]);
  }, []);

  return {
    filteredFiles, cursor: clamped, depFiles, selected, sortBy,
    moveCursor, toggleCursor, selectAllVisible, deselectAll,
    addDepsOfCursor, cycleSortBy, setSelected,
  };
}
