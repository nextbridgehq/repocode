import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import type { RepoCodeConfig } from '../../src/types.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';

let tmpDir: string;

function gitCmd(cmd: string): void {
  execSync(cmd, { cwd: tmpDir, stdio: 'pipe' });
}

function makeConfig(git: NonNullable<RepoCodeConfig['git']>): RepoCodeConfig {
  return { ...DEFAULT_CONFIG, root: tmpDir, git };
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-gd-'));
  gitCmd('git init');
  gitCmd('git config user.email "t@t.com"');
  gitCmd('git config user.name "T"');

  fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(tmpDir, 'b.ts'), 'export const b = 2;\n');
  gitCmd('git add .');
  gitCmd('git commit -m "init"');

  // Unstaged change to a.ts
  fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'export const a = 99;\n');

  // Untracked file
  fs.writeFileSync(path.join(tmpDir, 'new.ts'), 'export const n = 0;\n');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('gitDiscovery', () => {
  it('diff mode: returns modified file with source git-changed and tracked true', async () => {
    const { gitDiscovery } = await import('../../src/git/gitDiscovery.js');
    const config = makeConfig({ mode: 'diff', deps: false });
    const result = await gitDiscovery(config, () => false);
    const aFile = result.find(f => f.path === 'a.ts');
    expect(aFile).toBeDefined();
    expect(aFile?.source).toBe('git-changed');
    expect(aFile?.tracked).toBe(true);
  });

  it('diff mode: returns untracked file with tracked false', async () => {
    const { gitDiscovery } = await import('../../src/git/gitDiscovery.js');
    const config = makeConfig({ mode: 'diff', deps: false });
    const result = await gitDiscovery(config, () => false);
    const newFile = result.find(f => f.path === 'new.ts');
    expect(newFile).toBeDefined();
    expect(newFile?.tracked).toBe(false);
    expect(newFile?.source).toBe('git-changed');
  });

  it('staged mode: returns empty when nothing is staged', async () => {
    const { gitDiscovery } = await import('../../src/git/gitDiscovery.js');
    const config = makeConfig({ mode: 'staged', deps: false });
    const result = await gitDiscovery(config, () => false);
    // a.ts is unstaged, new.ts is untracked — neither are staged
    expect(result.find(f => f.path === 'a.ts')).toBeUndefined();
  });

  it('log mode: returns files from the first commit', async () => {
    const { gitDiscovery } = await import('../../src/git/gitDiscovery.js');
    const config = makeConfig({ mode: 'log', n: 1, deps: false });
    const result = await gitDiscovery(config, () => false);
    // init commit added a.ts and b.ts
    expect(result.some(f => f.path === 'a.ts' || f.path === 'b.ts')).toBe(true);
  });

  it('deleted files get deleted: true and are not stat-checked', async () => {
    const { gitDiscovery } = await import('../../src/git/gitDiscovery.js');
    // Simulate a deleted file by staging a deletion
    execSync('git rm b.ts', { cwd: tmpDir, stdio: 'pipe' });
    const config = makeConfig({ mode: 'staged', deps: false });
    let result: Awaited<ReturnType<typeof gitDiscovery>>;
    try {
      result = await gitDiscovery(config, () => false);
      const deletedFile = result.find(f => f.path === 'b.ts');
      expect(deletedFile).toBeDefined();
      expect(deletedFile?.deleted).toBe(true);
      expect(deletedFile?.size).toBe(0);
    } finally {
      // Restore for other tests
      execSync('git checkout HEAD -- b.ts', { cwd: tmpDir, stdio: 'pipe' });
    }
  });

  it('all files have absolutePath pointing into root', async () => {
    const { gitDiscovery } = await import('../../src/git/gitDiscovery.js');
    const config = makeConfig({ mode: 'diff', deps: false });
    const result = await gitDiscovery(config, () => false);
    for (const f of result) {
      expect(f.absolutePath.startsWith(tmpDir)).toBe(true);
    }
  });
});
