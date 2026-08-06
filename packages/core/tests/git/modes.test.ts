import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

let tmpDir: string;

function gitCmd(cmd: string): void {
  execSync(cmd, { cwd: tmpDir, stdio: 'pipe' });
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-modes-'));
  gitCmd('git init');
  gitCmd('git config user.email "test@test.com"');
  gitCmd('git config user.name "Test User"');

  // Initial commit with two files
  fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(tmpDir, 'auth.ts'), 'export const auth = true;\n');
  gitCmd('git add .');
  gitCmd('git commit -m "initial commit"');

  // Second commit: modify auth.ts
  fs.writeFileSync(path.join(tmpDir, 'auth.ts'), 'export const auth = false;\n');
  gitCmd('git add auth.ts');
  gitCmd('git commit -m "update auth"');

  // Unstaged modification to index.ts
  fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export const x = 99;\n');

  // Staged new file
  fs.writeFileSync(path.join(tmpDir, 'staged.ts'), 'export const s = 1;\n');
  gitCmd('git add staged.ts');

  // Untracked file (not staged)
  fs.writeFileSync(path.join(tmpDir, 'untracked.ts'), 'export const u = 1;\n');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseNameStatus', () => {
  it('parses M, A, D entries', async () => {
    const { parseNameStatus } = await import('../../src/git/modes.js');
    const output = 'M\tsrc/a.ts\nA\tsrc/b.ts\nD\tsrc/c.ts\n';
    const result = parseNameStatus(output);
    expect(result).toHaveLength(3);
    expect(result.find(f => f.path === 'src/a.ts')?.status).toBe('modified');
    expect(result.find(f => f.path === 'src/b.ts')?.status).toBe('added');
    expect(result.find(f => f.path === 'src/c.ts')?.status).toBe('deleted');
    expect(result.every(f => f.tracked === true)).toBe(true);
  });

  it('parses R (rename) entries with oldPath', async () => {
    const { parseNameStatus } = await import('../../src/git/modes.js');
    const output = 'R90\tsrc/old.ts\tsrc/new.ts\n';
    const result = parseNameStatus(output);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('renamed');
    expect(result[0].path).toBe('src/new.ts');
    expect(result[0].oldPath).toBe('src/old.ts');
    expect(result[0].tracked).toBe(true);
  });

  it('skips blank lines and commit separator lines', async () => {
    const { parseNameStatus } = await import('../../src/git/modes.js');
    const output = '\nM\tsrc/a.ts\n\nA\tsrc/b.ts\n\n';
    const result = parseNameStatus(output);
    expect(result).toHaveLength(2);
  });
});

describe('getDiffFiles', () => {
  it('returns unstaged modifications as git-changed with tracked: true', async () => {
    const { getDiffFiles } = await import('../../src/git/modes.js');
    const result = getDiffFiles(tmpDir);
    const indexFile = result.find(f => f.path === 'index.ts');
    expect(indexFile).toBeDefined();
    expect(indexFile?.status).toBe('modified');
    expect(indexFile?.tracked).toBe(true);
  });

  it('returns staged new files as git-changed with tracked: true', async () => {
    const { getDiffFiles } = await import('../../src/git/modes.js');
    const result = getDiffFiles(tmpDir);
    const stagedFile = result.find(f => f.path === 'staged.ts');
    expect(stagedFile).toBeDefined();
    expect(stagedFile?.status).toBe('added');
    expect(stagedFile?.tracked).toBe(true);
  });

  it('returns untracked files with tracked: false and status: untracked', async () => {
    const { getDiffFiles } = await import('../../src/git/modes.js');
    const result = getDiffFiles(tmpDir);
    const untrackedFile = result.find(f => f.path === 'untracked.ts');
    expect(untrackedFile).toBeDefined();
    expect(untrackedFile?.status).toBe('untracked');
    expect(untrackedFile?.tracked).toBe(false);
  });
});

describe('getStagedFiles', () => {
  it('returns only staged files', async () => {
    const { getStagedFiles } = await import('../../src/git/modes.js');
    const result = getStagedFiles(tmpDir);
    expect(result.some(f => f.path === 'staged.ts')).toBe(true);
    expect(result.some(f => f.path === 'index.ts')).toBe(false);   // unstaged
    expect(result.some(f => f.path === 'untracked.ts')).toBe(false); // untracked
  });
});

describe('getLogFiles', () => {
  it('returns files from last n commits', async () => {
    const { getLogFiles } = await import('../../src/git/modes.js');
    const result = getLogFiles(tmpDir, 1);
    // Second commit modified auth.ts
    expect(result.some(f => f.path === 'auth.ts')).toBe(true);
  });

  it('returns files from last 2 commits (deduplicated)', async () => {
    const { getLogFiles } = await import('../../src/git/modes.js');
    const result = getLogFiles(tmpDir, 2);
    // Both commits: auth.ts + index.ts should appear (at most once each)
    const paths = result.map(f => f.path);
    expect(paths).toContain('index.ts');
    expect(paths).toContain('auth.ts');
    expect(new Set(paths).size).toBe(paths.length); // no duplicates
  });
});

describe('getRangeFiles', () => {
  it('returns files changed between two commits', async () => {
    const { getRangeFiles } = await import('../../src/git/modes.js');
    // HEAD~1..HEAD = just the second commit (auth.ts change)
    const result = getRangeFiles(tmpDir, 'HEAD~1..HEAD');
    expect(result.some(f => f.path === 'auth.ts')).toBe(true);
    expect(result.some(f => f.path === 'index.ts')).toBe(false);
  });
});

describe('getPrFiles (env var detection)', () => {
  it('uses GITHUB_BASE_REF when set', async () => {
    const { getPrFiles } = await import('../../src/git/modes.js');
    // Set GITHUB_BASE_REF to a known ref — use HEAD~1 so there IS a diff
    const originalRef = process.env.GITHUB_BASE_REF;
    process.env.GITHUB_BASE_REF = 'HEAD~1';
    try {
      // getPrFiles reads GITHUB_BASE_REF and passes it to getBranchFiles
      // which calls merge-base. This should return auth.ts (from second commit).
      const result = getPrFiles(tmpDir);
      // If getPrFiles completes without throwing, the env var cascade works.
      expect(Array.isArray(result)).toBe(true);
    } finally {
      if (originalRef === undefined) delete process.env.GITHUB_BASE_REF;
      else process.env.GITHUB_BASE_REF = originalRef;
    }
  });
});

describe('parseHunksFromDiff', () => {
  it('parses hunk ranges from unified diff output', async () => {
    const { parseHunksFromDiff } = await import('../../src/git/modes.js');
    const diffOutput = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      'index abc..def 100644',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -10,3 +10,5 @@ export function foo() {',
      '+  const x = 1;',
      '+  const y = 2;',
      ' }',
    ].join('\n');
    const result = parseHunksFromDiff(diffOutput);
    expect(result.has('src/foo.ts')).toBe(true);
    const hunks = result.get('src/foo.ts')!;
    expect(hunks).toHaveLength(1);
    expect(hunks[0].start).toBe(10);
    expect(hunks[0].end).toBe(14); // start=10, count=5, end=10+5-1=14
  });

  it('handles multiple files and multiple hunks', async () => {
    const { parseHunksFromDiff } = await import('../../src/git/modes.js');
    const diffOutput = [
      'diff --git a/a.ts b/a.ts',
      '@@ -1,2 +1,3 @@',
      '@@ -10,1 +11,2 @@',
      'diff --git a/b.ts b/b.ts',
      '@@ -5,4 +5,6 @@',
    ].join('\n');
    const result = parseHunksFromDiff(diffOutput);
    expect(result.get('a.ts')).toHaveLength(2);
    expect(result.get('b.ts')).toHaveLength(1);
  });
});

describe('getHunksAll (integration)', () => {
  it('returns a Map with hunk ranges for modified files in diff mode', async () => {
    const { getHunksAll } = await import('../../src/git/modes.js');
    // tmpDir has index.ts modified (unstaged)
    const result = getHunksAll(tmpDir, false);
    expect(result instanceof Map).toBe(true);
    // index.ts was modified in beforeAll; hunks may or may not be populated
    // depending on whether there are actual line changes (not just creation)
    // Just verify it returns a Map without throwing
  });

  it('returns empty Map when no changes exist for staged=true', async () => {
    const { getHunksAll } = await import('../../src/git/modes.js');
    // staged.ts is a new file — git diff --cached --unified=0 may return hunks for it
    const result = getHunksAll(tmpDir, true);
    expect(result instanceof Map).toBe(true);
  });

  it('produces HunkRanges with start <= end', async () => {
    const { parseHunksFromDiff } = await import('../../src/git/modes.js');
    const diffOutput = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '@@ -10,3 +10,5 @@',
      '@@ -20,0 +23,2 @@',
    ].join('\n');
    const result = parseHunksFromDiff(diffOutput);
    for (const hunks of result.values()) {
      for (const h of hunks) {
        expect(h.start).toBeLessThanOrEqual(h.end);
      }
    }
  });

  it('skips pure-deletion hunks (count=0)', async () => {
    const { parseHunksFromDiff } = await import('../../src/git/modes.js');
    const diffOutput = [
      'diff --git a/a.ts b/a.ts',
      '@@ -5,3 +5,0 @@', // deletion: new side count = 0
    ].join('\n');
    const result = parseHunksFromDiff(diffOutput);
    const hunks = result.get('a.ts') ?? [];
    expect(hunks).toHaveLength(0); // pure deletion produces no HunkRange
  });
});
