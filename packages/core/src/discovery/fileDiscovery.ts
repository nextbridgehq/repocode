import { isBinary } from 'istextorbinary';
import fs from 'fs';
import path from 'path';
import type { DiscoveredFile, IgnoreConfig } from '../types.js';
import {
  buildIgnoreFilter,
  computeDefaultIncludeRoots,
  findAlwaysPrunedDirs,
  findIgnoredDirs,
  globbyMulti,
  DEFAULT_PATTERNS,
} from './ignoreRules.js';

export const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
  rb: 'ruby', php: 'php', cs: 'csharp', cpp: 'cpp', c: 'c',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  md: 'markdown', txt: 'text', html: 'html', css: 'css', scss: 'scss',
};

export interface FileDiscoveryOptions {
  root: string;
  include: string[];
  exclude: string[];
  ignore: IgnoreConfig;
  maxFileSizeBytes: number;
}

export async function discoverFiles(
  options: FileDiscoveryOptions
): Promise<DiscoveredFile[]> {
  const { root, include, exclude, ignore, maxFileSizeBytes } = options;

  // When the caller doesn't specify --include, computeDefaultIncludeRoots stands in for the
  // naive `**/*` with an explicit list of scoped patterns that never touch a default-excluded
  // directory (node_modules, dist, etc.) at any depth — see its docstring for why a plain
  // `**/*` plus `ignore` patterns crawls this repo's own tree for 10+ seconds instead of
  // milliseconds. A caller-supplied --include is trusted as-is, matching prior behaviour.
  const includePatterns = include.length > 0
    ? include
    : (ignore.useDefaultPatterns ? computeDefaultIncludeRoots(root) : ['**/*']);

  const filter = await buildIgnoreFilter(root, ignore);
  // Deliberately narrower than the full ignore set buildIgnoreFilter computes: .gitignore,
  // .repocodeignore, and custom patterns can contain gitignore negation (`!keep.me`), which
  // globby's `ignore` option can't honor — a broader pattern pruning the walk before a later
  // negation could "rescue" the file silently drops it with no chance for the post-filter below
  // to recover it. DEFAULT_PATTERNS (hardcoded, negation-free) and `exclude` (plain user globs,
  // not gitignore syntax) are safe to prune at the walk level; everything else is enforced only
  // by `filter` below, which correctly handles negation via the real `ignore` package.
  // DEFAULT_PATTERNS alone only prunes traversal for a node_modules/.git/dist/etc that sits
  // directly under root — see findAlwaysPrunedDirs for why an unanchored pattern doesn't
  // reliably prune nested occurrences (e.g. per-package node_modules in a workspace monorepo).
  // Locate every nested occurrence and add an exact anchored pattern for each so a
  // caller-supplied --include walk never descends into one, regardless of depth.
  const nestedPrunePatterns = ignore.useDefaultPatterns
    ? findAlwaysPrunedDirs(root).map(rel => `${rel}/**`)
    : [];

  // Directories .gitignore and friends exclude: prune them from the walk too, rather than
  // crawling every file in them just to filter each one out below.
  const ignoredDirPatterns = findIgnoredDirs(root, ignore).map(rel => `${rel}/**`);

  const globbyIgnorePatterns = [
    ...(ignore.useDefaultPatterns ? DEFAULT_PATTERNS : []),
    ...nestedPrunePatterns,
    ...ignoredDirPatterns,
    ...exclude,
  ];

  const rawPaths = await globbyMulti(includePatterns, {
    cwd: root,
    ignore: globbyIgnorePatterns,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
  });

  const results: DiscoveredFile[] = [];

  for (const relPath of rawPaths) {
    const normalized = relPath.replace(/\\/g, '/');
    if (!filter(normalized)) continue;

    const absPath = path.join(root, relPath);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absPath);
    } catch {
      continue;
    }

    if (stat.size > maxFileSizeBytes) continue;

    const ext = path.extname(relPath).slice(1).toLowerCase();
    const language = LANGUAGE_MAP[ext] ?? null;

    // isBinary(filename?, buffer?) — use filename for extension-based detection first
    let binary: boolean;
    const binaryByName = isBinary(path.basename(relPath));
    if (binaryByName !== null) {
      binary = binaryByName;
    } else {
      // Extension unknown — fall back to buffer inspection
      try {
        const buf = fs.readFileSync(absPath);
        const binaryByBuf = isBinary(null, buf);
        binary = binaryByBuf ?? false;
      } catch {
        binary = true;
      }
    }

    results.push({
      path: normalized,
      absolutePath: absPath,
      size: stat.size,
      language,
      mtime: stat.mtime,
      isBinary: binary,
      source: 'normal',
    });
  }

  // globby walks directories concurrently, so its output order varies between runs on the
  // same tree. Downstream ranking breaks score ties by input order, which would make the
  // whole selection nondeterministic. Sort by code unit (not locale) so the order is also
  // stable across machines.
  results.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return results;
}
