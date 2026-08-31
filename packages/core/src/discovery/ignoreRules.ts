import Ignore from 'ignore';
import { globby, type Options as GlobbyOptions } from 'globby';
import fs from 'fs';
import path from 'path';
import type { IgnoreConfig } from '../types.js';

export const DEFAULT_PATTERNS = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  'out/**',
  '.next/**',
  '.nuxt/**',
  'coverage/**',
  '*.min.js',
  '*.bundle.js',
  '**/*.map',
];

const PRUNE_DIR_NAMES = DEFAULT_PATTERNS
  .filter(p => p.endsWith('/**'))
  .map(p => p.slice(0, -3));

/**
 * globby (fast-glob) only reliably prunes directory *traversal* — not just the final file
 * list — for ignore patterns anchored to the search root, like `node_modules/**`. An
 * unanchored `**\/node_modules/**` does not reliably stop fast-glob's DeepFilter from
 * descending into it (verified directly against fast-glob 3.3.3's depth-regex handling), so a
 * workspace with per-package `node_modules` directories (any pnpm/yarn/npm monorepo, including
 * this repo) makes discovery crawl the entire dependency tree before filtering it back out —
 * minutes instead of milliseconds. Find every occurrence of a default-excluded directory name
 * ourselves, cheaply, by walking only the non-excluded tree (never descending into a match),
 * and turn each into an exact anchored pattern globby *can* prune on.
 */
export function findAlwaysPrunedDirs(root: string): string[] {
  const found: string[] = [];

  function walk(absDir: string, relDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (entry.name.startsWith('.') && !PRUNE_DIR_NAMES.includes(entry.name)) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (PRUNE_DIR_NAMES.includes(entry.name)) {
        found.push(rel);
        continue;
      }
      walk(path.join(absDir, entry.name), rel);
    }
  }

  walk(root, '');
  return found;
}

/**
 * Even with findAlwaysPrunedDirs' exact anchored ignore patterns in place, discovery still
 * crawled this repo's own tree for 10+ seconds instead of milliseconds. Traced it to a second,
 * independent fast-glob behaviour: any pattern with no directory prefix (a bare `*`, matching
 * files directly under the search root) has a "base directory" of `.` — and fast-glob merges
 * *every* pattern that shares the current directory into a single unsplit task the moment one
 * of them is root-anchored (`tasks.js`: `if ('.' in insideCurrentDirectoryGroup)`), silently
 * discarding the per-directory task splitting that keeps scoped patterns (`packages/core/src/**`)
 * fast. The single `**\/*` this module used to hand globby is exactly that root-anchored case.
 *
 * Compute an explicit include-pattern list instead: one scoped pattern (`<dir>/**`) per
 * subtree that contains no default-excluded directory, so fast-glob's traversal never has a
 * reason to open a `node_modules`-shaped directory, and never collapses into one root task
 * because none of these patterns (other than direct-file `*` patterns, kept separate by the
 * caller — see fileDiscovery.ts) are root-anchored.
 *
 * Returns `['**\/*']` unchanged when the tree has no default-excluded directory at all, since
 * there is nothing to prune and the plain pattern is already fine.
 */
export function computeDefaultIncludeRoots(root: string): string[] {
  const roots: string[] = [];

  // Returns true if this directory contains a default-excluded directory anywhere beneath it.
  function walk(absDir: string, relDir: string): boolean {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return false;
    }

    const childDirs: { rel: string; abs: string }[] = [];
    let sawPrunedChild = false;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (entry.name.startsWith('.') && !PRUNE_DIR_NAMES.includes(entry.name)) continue;
      if (PRUNE_DIR_NAMES.includes(entry.name)) {
        sawPrunedChild = true;
        continue;
      }
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      childDirs.push({ rel, abs: path.join(absDir, entry.name) });
    }

    let anyDescendantPruned = sawPrunedChild;
    const cleanChildren: { rel: string }[] = [];
    for (const child of childDirs) {
      if (walk(child.abs, child.rel)) {
        anyDescendantPruned = true;
      } else {
        cleanChildren.push(child);
      }
    }

    if (!anyDescendantPruned) {
      // This entire subtree is free of default-excluded directories; the caller folds it
      // into a single `<dir>/**` root instead of descending further itself.
      return false;
    }

    roots.push(relDir ? `${relDir}/*` : '*');
    for (const child of cleanChildren) {
      roots.push(`${child.rel}/**`);
    }
    return true;
  }

  const rootHasPrunedDescendant = walk(root, '');
  return rootHasPrunedDescendant ? roots : ['**/*'];
}

/**
 * Rewrites computeDefaultIncludeRoots' directory-scoped patterns to only match a given
 * extension-glob suffix (e.g. `*.{ts,py,go}`) within each safe subtree, so a caller that only
 * wants source files (graphBuilder's import-graph pass) gets the same pruning without walking
 * every file type.
 */
export function withExtensionGlob(roots: string[], extensionGlob: string): string[] {
  return roots.map(pattern => {
    if (pattern === '**/*') return `**/${extensionGlob}`;
    if (pattern.endsWith('/**')) return `${pattern.slice(0, -3)}/**/${extensionGlob}`;
    if (pattern.endsWith('/*')) return `${pattern.slice(0, -2)}/${extensionGlob}`;
    return pattern;
  });
}

/**
 * A pattern with no directory prefix (a bare `*`, matching files directly under `cwd`) has a
 * "base directory" of `.` to fast-glob — and the moment one is present, fast-glob merges every
 * pattern that shares the current directory into a single unsplit task rooted at `cwd` (see
 * computeDefaultIncludeRoots). That silently defeats the per-directory task splitting that
 * keeps the other, scoped patterns fast. Route root-anchored patterns through their own call so
 * they can't drag the scoped ones back into one big unpruned walk.
 */
export async function globbyMulti(patterns: string[], options: GlobbyOptions): Promise<string[]> {
  const rootAnchored = patterns.filter(p => !p.includes('/'));
  const scoped = patterns.filter(p => p.includes('/'));

  const [rootResults, scopedResults] = await Promise.all([
    rootAnchored.length > 0 ? globby(rootAnchored, options) : Promise.resolve([]),
    scoped.length > 0 ? globby(scoped, options) : Promise.resolve([]),
  ]);

  return [...rootResults, ...scopedResults];
}

export function resolveIgnorePatterns(root: string, config: IgnoreConfig): string[] {
  const patterns: string[] = [];

  if (config.useDefaultPatterns) {
    patterns.push(...DEFAULT_PATTERNS);
  }

  if (config.useGitignore) {
    const gitignorePath = path.join(root, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      patterns.push(...fs.readFileSync(gitignorePath, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean));
    }
  }

  const ccignorePath = path.join(root, '.repocodeignore');
  if (fs.existsSync(ccignorePath)) {
    patterns.push(...fs.readFileSync(ccignorePath, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean));
  }

  // Honour .repomixignore too. It is gitignore syntax and states which files the author does
  // not want packed — a preference that does not change with the tool reading it. Trying
  // RepoCode in a repo already set up for Repomix should not require re-declaring exclusions.
  const repomixIgnorePath = path.join(root, '.repomixignore');
  if (fs.existsSync(repomixIgnorePath)) {
    patterns.push(...fs.readFileSync(repomixIgnorePath, 'utf-8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')));
  }

  if (config.customPatterns.length > 0) {
    patterns.push(...config.customPatterns);
  }

  return patterns;
}

export async function buildIgnoreFilter(
  root: string,
  config: IgnoreConfig
): Promise<(filePath: string) => boolean> {
  const ig = Ignore();
  ig.add(resolveIgnorePatterns(root, config));

  return (filePath: string) => {
    const normalized = filePath.replace(/\\/g, '/');
    return !ig.ignores(normalized);
  };
}
