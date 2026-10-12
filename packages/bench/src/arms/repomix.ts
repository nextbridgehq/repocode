import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import fs from 'fs';
import type { Retrieval } from '../scoring.js';

const execFileAsync = promisify(execFile);

/** The Repomix the published numbers were measured with. Pinned here rather than as a dependency:
 *  the harness never imports Repomix, and a dev dependency would drag its vulnerable transitive
 *  packages into the workspace lockfile and the CI audit. */
const REPOMIX_VERSION = '1.14.0';

// Rough token estimate: ~3.5 chars per token for code
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

const SOURCE_EXT = /\.(py|pyi|ts|tsx|js|jsx|mjs|go|rs|rb|java|kt|cs|php|c|h|cc|cpp|hpp|swift)$/;
/** Reproduction code that only imports a module names the API it uses, not the file at fault. */
const PLAIN_IMPORT_LINE = /^[^\S\n]*(?:>>>[^\S\n]*)?import[^\S\n]+[\w.]+(?:[^\S\n]+as[^\S\n]+\w+)?(?:[^\S\n]*,[^\S\n]*[\w.]+(?:[^\S\n]+as[^\S\n]+\w+)?)*[^\S\n]*$/gm;
const SOURCE_ROOTS = new Set(['lib', 'src', 'source', 'python']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.repocode']);

function listFiles(dir: string, root = dir, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(full, root, out);
    else out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out;
}

/** Repo files an issue names, the way a person skimming it would pick them out: a path, a dotted
 *  module, or a traceback line naming the installed copy. This is the hint a Repomix user would
 *  turn into `--include`. It is deliberately independent of RepoCode's own ranking code. */
export function filesNamedInIssue(issue: string, repoDir: string, max = 20): string[] {
  const files = listFiles(repoDir).filter(f => SOURCE_EXT.test(f));
  const found = new Set<string>();
  for (const tok of issue.replace(PLAIN_IMPORT_LINE, '').match(/[A-Za-z0-9_][A-Za-z0-9_./-]*[./][A-Za-z0-9_./-]*[A-Za-z0-9_]/g) ?? []) {
    const explicitExt = SOURCE_EXT.test(tok);
    const base = tok.replace(SOURCE_EXT, '');
    const mention = (tok.includes('/') ? base : base.replace(/\./g, '/')).replace(/^\.?\//, '');
    if (mention.split('/').filter(Boolean).length < (explicitExt ? 1 : 2)) continue; // a lone dot is prose
    for (const f of files) {
      const stem = f.replace(SOURCE_EXT, '').replace(/\/(?:__init__|index)$/, '');
      const segs = stem.split('/');
      while (segs.length > 2 && SOURCE_ROOTS.has(segs[0])) segs.shift();
      const pkgRelative = segs.join('/');
      if (stem === mention || stem.endsWith('/' + mention) || (segs.length >= 2 && mention.endsWith('/' + pkgRelative))) {
        found.add(f);
      }
    }
  }
  return [...found].sort().slice(0, max);
}

/** Take files in Repomix's own order while they fit, stopping at the first that does not.
 *  Skipping past an oversized file and continuing makes recall non-monotone: measured on
 *  astropy, the old behaviour selected 82 files at 50k and only 74 at 100k. */
export function selectWithinBudget(
  files: Array<{ path: string; tokens: number; chars: number; content?: string }>,
  budgetTokens: number,
): Retrieval[] {
  const selected: Retrieval[] = [];
  let used = 0;
  for (const file of files) {
    if (used + file.tokens > budgetTokens) break;
    used += file.tokens;
    // `chars` is the compressed content repomix actually emitted, not the file on disk —
    // this arm runs with --compress, so what it delivers is usually a fraction of the file.
    selected.push({ path: file.path, chars: file.chars, content: file.content });
  }
  return selected;
}

export async function runRepomix(
  repoDir: string,
  budgetTokens: number,
  /** `include` narrows the pack to those repo paths; `compress` (default on) keeps only signatures. */
  opts: { include?: string[]; compress?: boolean } = {},
): Promise<Retrieval[]> {
  // Written outside the repo so it cannot become input to a later arm. Previously this landed
  // in repoDir as an 18 MB XML file that subsequent runs then ranked and packed.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-repomix-'));
  const outPath = path.join(outDir, 'repomix-output.xml');
  const args = [
    '--output', outPath,
    ...(opts.compress === false ? [] : ['--compress']),
    ...(opts.include?.length ? ['--include', opts.include.join(',')] : []),
    // repocode writes its file cache into the tree it packs; without this Repomix ingests it,
    // and it ranked .repocode/cache.json as the very first file on two instances.
    '--ignore', '.repocode/**',
  ];

  try {
    await execFileAsync('npx', ['--yes', `repomix@${REPOMIX_VERSION}`, ...args], { cwd: repoDir, maxBuffer: 1024 * 1024 * 50, shell: process.platform === 'win32' });

    if (!fs.existsSync(outPath)) {
      return [];
    }

    const xml = fs.readFileSync(outPath, 'utf-8');

    // Parse all files with their content to enforce token budget
    const files: Array<{ path: string, tokens: number, chars: number, content: string }> = [];
    const regex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const content = match[2];
      files.push({ path: match[1], tokens: estimateTokens(content), chars: content.trim().length, content });
    }

    // Repomix emits files in its own order (measured: not alphabetical — it groups by
    // directory and its own heuristics). We keep whatever order it chose and truncate,
    // which is what a consumer hitting a context limit would get.
    return selectWithinBudget(files, budgetTokens);
  } catch (error) {
    console.error(`repomix arm failed in ${repoDir}`, error);
    return [];
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}
