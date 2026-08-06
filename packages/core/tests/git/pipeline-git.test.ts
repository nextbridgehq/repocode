import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { runPipeline, loadConfig } from '../../src/index.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import type { RepoCodeConfig } from '../../src/types.js';

let tmpDir: string;

function gitCmd(cmd: string): void {
  execSync(cmd, { cwd: tmpDir, stdio: 'pipe' });
}

function makeGitConfig(git: NonNullable<RepoCodeConfig['git']>): RepoCodeConfig {
  return {
    ...DEFAULT_CONFIG,
    root: tmpDir,
    security: { enabled: false, mode: 'warn' },
    git,
  };
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-pipeline-git-'));
  gitCmd('git init');
  gitCmd('git config user.email "t@t.com"');
  gitCmd('git config user.name "T"');

  fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export const i = 1;\n');
  fs.writeFileSync(path.join(tmpDir, 'utils.ts'), 'export const u = 2;\n');
  gitCmd('git add .');
  gitCmd('git commit -m "init"');

  // Unstaged modification
  fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export const i = 99;\n');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('pipeline git mode', () => {
  it('--diff: includes modified file in output', async () => {
    const config = makeGitConfig({ mode: 'diff', deps: false });
    const result = await runPipeline(config);
    expect(result.included.some(f => f.path === 'index.ts')).toBe(true);
  });

  it('--diff: modified file has source git-changed', async () => {
    const config = makeGitConfig({ mode: 'diff', deps: false });
    const result = await runPipeline(config);
    const f = result.included.find(f => f.path === 'index.ts');
    expect(f?.source).toBe('git-changed');
  });

  it('deleted file stubs appear in included with content [DELETED]', async () => {
    // Stage a deletion
    execSync('git rm utils.ts', { cwd: tmpDir, stdio: 'pipe' });
    const config = makeGitConfig({ mode: 'staged', deps: false });
    const result = await runPipeline(config);
    const deleted = result.included.find(f => f.path === 'utils.ts');
    expect(deleted).toBeDefined();
    expect(deleted?.deleted).toBe(true);
    expect(deleted?.content).toBe('[DELETED]');
    expect(deleted?.tokens).toBe(0);
    // Restore
    execSync('git checkout HEAD -- utils.ts', { cwd: tmpDir, stdio: 'pipe' });
  });

  it('untracked file has lower score than modified file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'untracked.ts'), 'export const un = 0;\n');
    const config = makeGitConfig({ mode: 'diff', deps: false });
    const result = await runPipeline(config);
    const modified = result.included.find(f => f.path === 'index.ts');
    const untracked = result.included.find(f => f.path === 'untracked.ts');
    if (modified && untracked) {
      expect(modified.score).toBeGreaterThan(untracked.score);
    }
    fs.unlinkSync(path.join(tmpDir, 'untracked.ts'));
  });

  it('--diff with deps: true includes a real dependency of the changed file', async () => {
    fs.writeFileSync(path.join(tmpDir, 'helper.ts'), 'export const h = 1;\n');
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), "import { h } from './helper.js';\nexport const i = h + 100;\n");
    gitCmd('git add helper.ts index.ts');
    gitCmd('git commit -m "add helper"');
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), "import { h } from './helper.js';\nexport const i = h + 999;\n");

    const config = makeGitConfig({ mode: 'diff', deps: true });
    const result = await runPipeline(config);

    expect(result.included.some(f => f.path === 'helper.ts' && f.source === 'git-dep')).toBe(true);
  });
});
