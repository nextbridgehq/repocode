import fs from 'fs';
import path from 'path';
import type { RepoCodeConfig, DiscoveredFile, GitChangedFile } from '../types.js';
import { LANGUAGE_MAP } from '../discovery/fileDiscovery.js';
import { getDiffFiles, getStagedFiles, getBranchFiles, getLogFiles, getRangeFiles, getPrFiles, getHunksAll } from './modes.js';
import { traceImports } from './importTracer.js';

function statExisting(root: string, relPath: string): DiscoveredFile | null {
  const absPath = path.join(root, relPath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return null;
  }
  const ext = path.extname(relPath).slice(1).toLowerCase();
  const normalized = relPath.replace(/\\/g, '/');
  return {
    path: normalized,
    absolutePath: absPath,
    size: stat.size,
    language: LANGUAGE_MAP[ext] ?? null,
    mtime: stat.mtime,
    isBinary: false,
    source: 'normal',
  };
}

function makeDeletedStub(root: string, relPath: string): DiscoveredFile {
  const normalized = relPath.replace(/\\/g, '/');
  const ext = path.extname(relPath).slice(1).toLowerCase();
  return {
    path: normalized,
    absolutePath: path.join(root, relPath),
    size: 0,
    language: LANGUAGE_MAP[ext] ?? null,
    mtime: new Date(0),
    isBinary: false,
    source: 'git-changed',
    deleted: true,
    tracked: true,
  };
}

export async function gitDiscovery(
  config: RepoCodeConfig,
  isExcluded: (filePath: string) => boolean,
  prebuiltImportMap?: Map<string, string[]>,
): Promise<DiscoveredFile[]> {
  const { root, git } = config;
  if (!git) throw new Error('gitDiscovery called without git config');

  // 1. Dispatch to mode function
  let changed: GitChangedFile[];
  switch (git.mode) {
    case 'diff':    changed = getDiffFiles(root); break;
    case 'staged':  changed = getStagedFiles(root); break;
    case 'branch':  changed = getBranchFiles(root, git.branch!, git.base); break;
    case 'log':     changed = getLogFiles(root, git.n ?? 1); break;
    case 'range':   changed = getRangeFiles(root, git.range!); break;
    case 'pr':      changed = getPrFiles(root, git.base); break;
  }

  // Fetch hunk line ranges for diff/staged modes (used by partial extraction)
  let hunkMap: Map<string, import('../types.js').HunkRange[]> | undefined;
  if (git.mode === 'diff') {
    const unstagedHunks = getHunksAll(root, false);
    const stagedHunks   = getHunksAll(root, true);
    hunkMap = new Map([...unstagedHunks, ...stagedHunks]); // staged overwrites unstaged
  } else if (git.mode === 'staged') {
    hunkMap = getHunksAll(root, true);
  }

  // 2. Partition: existing vs deleted
  const existing = changed.filter(f => f.status !== 'deleted');
  const deletedGit = changed.filter(f => f.status === 'deleted');

  // 3. Stat existing files
  const result: DiscoveredFile[] = [];
  const changedPaths: string[] = [];

  for (const f of existing) {
    const discovered = statExisting(root, f.path);
    if (!discovered) {
      // File disappeared after git output — treat as deleted
      result.push(makeDeletedStub(root, f.path));
      continue;
    }
    changedPaths.push(discovered.path);
    result.push({ ...discovered, source: 'git-changed', tracked: f.tracked, hunks: hunkMap?.get(discovered.path) });
  }

  // 4. Deleted file stubs
  for (const f of deletedGit) {
    result.push(makeDeletedStub(root, f.path));
  }

  // 5. Import tracing (deps: true by default)
  if (git.deps && changedPaths.length > 0) {
    const traced = await traceImports(
      changedPaths,
      root,
      isExcluded,
      config.graphDepth > 0 ? config.graphDepth : undefined,
      prebuiltImportMap,
    );
    const changedSet = new Set(changedPaths);
    const allDepPaths = [...new Set([...traced.importers, ...traced.dependencies])];
    for (const depPath of allDepPaths) {
      if (changedSet.has(depPath)) continue;
      if (isExcluded(depPath)) continue;
      const discovered = statExisting(root, depPath);
      if (!discovered) continue;
      result.push({ ...discovered, source: 'git-dep' });
    }
  }

  return result;
}
