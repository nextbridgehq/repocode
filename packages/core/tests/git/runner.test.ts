import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

// We test runGit against real git commands — no mocking needed.
// The success path uses the project repo (which is a git repo).
// The failure path uses a temp non-git directory.

describe('runGit', () => {
  it('returns stdout for a valid git command', async () => {
    const { runGit } = await import('../../src/git/runner.js');
    // git rev-parse HEAD returns the current commit hash — non-empty if in a git repo
    const root = process.cwd();
    const result = runGit(root, ['rev-parse', 'HEAD']);
    expect(result.trim()).toMatch(/^[0-9a-f]{40}$/);
  });

  it('throws an Error with descriptive message when not in a git repo', async () => {
    const { runGit } = await import('../../src/git/runner.js');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-notgit-'));
    try {
      expect(() => runGit(tmpDir, ['status'])).toThrow(/git status failed/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws an Error (not a raw process exit) on git failure', async () => {
    const { runGit } = await import('../../src/git/runner.js');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-notgit2-'));
    try {
      let threw = false;
      try {
        runGit(tmpDir, ['log', '--oneline']);
      } catch (e) {
        threw = true;
        expect(e).toBeInstanceOf(Error);
      }
      expect(threw).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
