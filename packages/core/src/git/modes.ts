import type { GitChangedFile, HunkRange } from '../types.js';
import { runGit } from './runner.js';

export function parseNameStatus(output: string): GitChangedFile[] {
  const results: GitChangedFile[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    const code = parts[0];
    if (!code || !/^[MADRC]/.test(code)) continue;

    if (code.startsWith('R')) {
      results.push({
        path: parts[2],
        status: 'renamed',
        tracked: true,
        oldPath: parts[1],
      });
    } else if (code === 'M') {
      results.push({ path: parts[1], status: 'modified', tracked: true });
    } else if (code === 'A') {
      results.push({ path: parts[1], status: 'added', tracked: true });
    } else if (code === 'D') {
      results.push({ path: parts[1], status: 'deleted', tracked: true });
    } else if (code === 'C') {
      // Copy — treat destination as added
      results.push({ path: parts[2], status: 'added', tracked: true });
    }
  }
  return results;
}

export function detectBase(root: string): string {
  try {
    const out = runGit(root, ['remote', 'show', 'origin']);
    const match = out.match(/HEAD branch:\s+(\S+)/);
    if (match) return match[1];
  } catch {
    // No remote or unreachable — fall through to local check
  }
  try {
    runGit(root, ['rev-parse', '--verify', 'main']);
    return 'main';
  } catch {
    return 'master';
  }
}

export function getDiffFiles(root: string): GitChangedFile[] {
  const unstagedOut = (() => {
    try { return runGit(root, ['diff', '--name-status']); } catch { return ''; }
  })();
  const stagedOut = (() => {
    try { return runGit(root, ['diff', '--cached', '--name-status']); } catch { return ''; }
  })();
  const untrackedOut = (() => {
    try { return runGit(root, ['ls-files', '--others', '--exclude-standard']); } catch { return ''; }
  })();

  const map = new Map<string, GitChangedFile>();
  for (const f of parseNameStatus(unstagedOut)) map.set(f.path, f);
  for (const f of parseNameStatus(stagedOut)) map.set(f.path, f);   // staged wins

  for (const line of untrackedOut.split('\n')) {
    const p = line.trim();
    if (!p || map.has(p)) continue;
    map.set(p, { path: p, status: 'untracked', tracked: false });
  }
  return [...map.values()];
}

export function getStagedFiles(root: string): GitChangedFile[] {
  const out = runGit(root, ['diff', '--cached', '--name-status']);
  return parseNameStatus(out);
}

export function getBranchFiles(root: string, branch: string, base?: string): GitChangedFile[] {
  const resolvedBase = base ?? detectBase(root);
  const mergeBase = runGit(root, ['merge-base', resolvedBase, branch]).trim();
  const out = runGit(root, ['diff', '--name-status', mergeBase, branch]);
  return parseNameStatus(out);
}

export function getLogFiles(root: string, n: number): GitChangedFile[] {
  const out = runGit(root, ['log', `-${n}`, '--name-status', '--format=']);
  const seen = new Map<string, GitChangedFile>();
  for (const f of parseNameStatus(out)) {
    if (!seen.has(f.path)) seen.set(f.path, f);
  }
  return [...seen.values()];
}

export function getRangeFiles(root: string, range: string): GitChangedFile[] {
  const [from, to] = range.split('..', 2);
  const out = runGit(root, ['diff', '--name-status', `${from}..${to}`]);
  return parseNameStatus(out);
}

export function getPrFiles(root: string, base?: string): GitChangedFile[] {
  const resolvedBase =
    base ??
    process.env.GITHUB_BASE_REF ??
    process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME ??
    process.env.SYSTEM_PULLREQUEST_TARGETBRANCH ??
    detectBase(root);
  const currentBranch = runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  return getBranchFiles(root, currentBranch, resolvedBase);
}

// ─── Hunk range extraction ────────────────────────────────────────────────────

// Parses `git diff --unified=0` output into a map of relative path → HunkRange[].
// Hunk line numbers are from the "+new" side of each @@ header (1-indexed).
export function parseHunksFromDiff(diffOutput: string): Map<string, HunkRange[]> {
  const result = new Map<string, HunkRange[]>();
  let currentFile: string | null = null;

  for (const line of diffOutput.split('\n')) {
    // File header: "diff --git a/path b/path"
    const fileMatch = line.match(/^diff --git a\/.+ b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1].trim();
      result.set(currentFile, []);
      continue;
    }

    // Hunk header: "@@ -old,n +new,count @@"
    if (currentFile && line.startsWith('@@ ')) {
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (hunkMatch) {
        const start = parseInt(hunkMatch[1], 10);
        const count = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
        if (count > 0) {
          result.get(currentFile)!.push({ start, end: start + count - 1 });
        }
      }
    }
  }

  return result;
}

// Runs `git diff [--cached] --unified=0` and returns the parsed hunk map.
// Returns an empty Map on error (e.g., not a git repo, nothing to diff).
export function getHunksAll(root: string, staged: boolean): Map<string, HunkRange[]> {
  try {
    const args = ['diff', '--unified=0'];
    if (staged) args.push('--cached');
    const output = runGit(root, args);
    return parseHunksFromDiff(output);
  } catch {
    return new Map();
  }
}
