import { globby } from 'globby';
import { isBinary } from 'istextorbinary';
import fs from 'fs';
import path from 'path';
import type { DiscoveredFile, IgnoreConfig } from '../types.js';
import { buildIgnoreFilter, DEFAULT_PATTERNS } from './ignoreRules.js';

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

  const includePatterns = include.length > 0 ? include : ['**/*'];
  const filter = await buildIgnoreFilter(root, ignore);
  // Deliberately narrower than the full ignore set buildIgnoreFilter computes: .gitignore,
  // .repocodeignore, and custom patterns can contain gitignore negation (`!keep.me`), which
  // globby's `ignore` option can't honor — a broader pattern pruning the walk before a later
  // negation could "rescue" the file silently drops it with no chance for the post-filter below
  // to recover it. DEFAULT_PATTERNS (hardcoded, negation-free) and `exclude` (plain user globs,
  // not gitignore syntax) are safe to prune at the walk level; everything else is enforced only
  // by `filter` below, which correctly handles negation via the real `ignore` package.
  const globbyIgnorePatterns = [
    ...(ignore.useDefaultPatterns ? DEFAULT_PATTERNS : []),
    ...exclude,
  ];

  const rawPaths = await globby(includePatterns, {
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

  return results;
}
