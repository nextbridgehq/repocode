import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '../dist/cli.js');

// Env vars that would otherwise make --pr's base auto-detection CI-dependent.
const CI_PR_ENV_VARS = ['GITHUB_BASE_REF', 'CI_MERGE_REQUEST_TARGET_BRANCH_NAME', 'SYSTEM_PULLREQUEST_TARGETBRANCH'];
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of CI_PR_ENV_VARS) delete env[key];
  return env;
}

function packJsonPaths(tmpDir: string, args: string[]): string[] {
  const result = spawnSync('node', [CLI, tmpDir, ...args, '--no-security', '--format', 'json', '--stdout'], {
    encoding: 'utf-8',
    env: cleanEnv(),
  });
  const parsed = JSON.parse(result.stdout);
  return parsed.files.map((f: { path: string }) => f.path);
}

describe('--branch / --base / --range / --pr', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-git-modes-'));
    const git = (...args: string[]) => execSync(`git ${args.join(' ')}`, { cwd: tmpDir, stdio: 'pipe' });

    git('init', '-q', '-b', 'main');
    git('config', 'user.email', '"t@t.com"');
    git('config', 'user.name', '"T"');

    fs.writeFileSync(path.join(tmpDir, 'base.ts'), 'export const base = 1;\n');
    git('add', '.');
    git('commit', '-qm', '"main: base"'); // main branch, commit 1

    git('checkout', '-qb', 'develop');
    fs.writeFileSync(path.join(tmpDir, 'develop-only.ts'), 'export const developOnly = 1;\n');
    git('add', '.');
    git('commit', '-qm', '"develop: add develop-only"'); // commit 2

    git('checkout', '-qb', 'feature');
    fs.writeFileSync(path.join(tmpDir, 'feature.ts'), 'export const feature = 1;\n');
    git('add', '.');
    git('commit', '-qm', '"feature: add feature"'); // commit 3, HEAD stays on feature
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('--branch with an explicit --base only shows commits exclusive to that base..branch range', () => {
    const paths = packJsonPaths(tmpDir, ['--branch', 'feature', '--base', 'develop']);
    expect(paths).toContain('feature.ts');
    expect(paths).not.toContain('develop-only.ts');
    expect(paths).not.toContain('base.ts');
  });

  it('--branch without --base auto-detects main as the base', () => {
    const paths = packJsonPaths(tmpDir, ['--branch', 'feature']);
    expect(paths).toContain('feature.ts');
    expect(paths).toContain('develop-only.ts'); // both commits are ahead of main
    expect(paths).not.toContain('base.ts');
  });

  it('--range <from>..<to> shows files touched across that commit range', () => {
    const paths = packJsonPaths(tmpDir, ['--range', 'main..feature']);
    expect(paths).toContain('feature.ts');
    expect(paths).toContain('develop-only.ts');
    expect(paths).not.toContain('base.ts');
  });

  it('--pr with an explicit --base diffs the current HEAD branch against it', () => {
    // HEAD is "feature" from the beforeAll setup.
    const paths = packJsonPaths(tmpDir, ['--pr', '--base', 'develop']);
    expect(paths).toContain('feature.ts');
    expect(paths).not.toContain('develop-only.ts');
  });

  it('--pr with no CI env vars and no --base falls back to auto-detected main', () => {
    const paths = packJsonPaths(tmpDir, ['--pr']);
    expect(paths).toContain('feature.ts');
    expect(paths).toContain('develop-only.ts');
    expect(paths).not.toContain('base.ts');
  });

  it('rejects combining two git-mode flags (e.g. --branch and --range together)', () => {
    const result = spawnSync('node', [CLI, tmpDir, '--branch', 'feature', '--range', 'main..feature', '--no-security'], { encoding: 'utf-8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('only one git mode flag may be used at a time');
  });
});

describe('--log validation', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-log-validation-'));
    execSync('git init -q -b main', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "t@t.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "T"', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'export const a = 1;\n');
    execSync('git add .', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -qm init', { cwd: tmpDir, stdio: 'pipe' });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects --log 0 as not a positive integer', () => {
    const result = spawnSync('node', [CLI, tmpDir, '--log', '0', '--no-security'], { encoding: 'utf-8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--log requires a positive integer');
  });

  it('rejects a non-numeric --log argument', () => {
    const result = spawnSync('node', [CLI, tmpDir, '--log', 'abc', '--no-security'], { encoding: 'utf-8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--log requires a positive integer');
  });

  it('accepts --log 1 and returns files from the last commit', () => {
    const paths = packJsonPaths(tmpDir, ['--log', '1']);
    expect(paths).toContain('a.ts');
  });
});

describe('--graph-depth and --no-deps (transitive import tracing in git modes)', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-graph-depth-'));
    const git = (...args: string[]) => execSync(`git ${args.join(' ')}`, { cwd: tmpDir, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', '"t@t.com"');
    git('config', 'user.name', '"T"');

    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'leaf.ts'), 'export const LEAF = 1;\n');
    fs.writeFileSync(path.join(tmpDir, 'src', 'mid.ts'), "import { LEAF } from './leaf.js';\nexport const MID = LEAF + 1;\n");
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), "import { MID } from './mid.js';\nexport const INDEX = MID + 1;\n");
    git('add', '.');
    git('commit', '-qm', 'init');
    // Unstaged change to index.ts only — mid.ts and leaf.ts are untouched dependencies.
    fs.appendFileSync(path.join(tmpDir, 'src', 'index.ts'), '// touched\n');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('default depth (2) pulls in both the direct and transitive dependency', () => {
    const paths = packJsonPaths(tmpDir, ['--diff']);
    expect(paths).toContain('src/index.ts');
    expect(paths).toContain('src/mid.ts');
    expect(paths).toContain('src/leaf.ts');
  });

  it('--graph-depth 1 pulls in only the direct dependency, not the transitive one', () => {
    const paths = packJsonPaths(tmpDir, ['--diff', '--graph-depth', '1']);
    expect(paths).toContain('src/index.ts');
    expect(paths).toContain('src/mid.ts');
    expect(paths).not.toContain('src/leaf.ts');
  });

  it('--no-deps disables dependency tracing entirely', () => {
    const paths = packJsonPaths(tmpDir, ['--diff', '--no-deps']);
    expect(paths).toContain('src/index.ts');
    expect(paths).not.toContain('src/mid.ts');
    expect(paths).not.toContain('src/leaf.ts');
  });
});
