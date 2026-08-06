import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '../dist/cli.js');
const FIXTURE = path.join(__dirname, '../../core/tests/fixtures/simple-ts');

// Quote paths that may contain spaces (Windows compatibility)
const qCLI = `"${CLI}"`;
const qFIXTURE = `"${FIXTURE}"`;

describe('CLI', () => {
  it('exits 0 and produces output on a valid project', () => {
    const result = execSync(
      `node ${qCLI} ${qFIXTURE} --format json --no-security --stdout`,
      { encoding: 'utf-8' }
    );
    const parsed = JSON.parse(result);
    expect(parsed.files.length).toBeGreaterThan(0);
  });

  it('prints summary to stderr', () => {
    // Use spawnSync to capture stderr directly (Windows-compatible, avoids 2>&1 redirect issues)
    const result = spawnSync(
      'node',
      [CLI, FIXTURE, '--no-security', '--stdout'],
      { encoding: 'utf-8' }
    );
    expect(result.stderr).toContain('Files:');
  });

  it('respects --budget flag', () => {
    const out = execSync(
      `node ${qCLI} ${qFIXTURE} --budget 500 --format json --no-security --stdout`,
      { encoding: 'utf-8' }
    );
    const parsed = JSON.parse(out);
    // With a very small budget, fewer files should be included
    expect(parsed.files.length).toBeLessThanOrEqual(3);
  });

  it('--no-budget sets budget to null in output', () => {
    // Commander converts --no-budget to opts.budget = false; verify pipeline gets null
    const out = execSync(
      `node ${qCLI} ${qFIXTURE} --no-budget --format json --no-security --stdout`,
      { encoding: 'utf-8' }
    );
    const parsed = JSON.parse(out);
    expect(parsed.metadata.budget).toBeNull();
  });

  it('--init creates a starter repocode.config.json in the target directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-init-'));
    try {
      const out = execSync(`node ${qCLI} "${tmpDir}" --init 2>&1`, { encoding: 'utf-8' });
      expect(out).toContain('Created');
      const configPath = path.join(tmpDir, 'repocode.config.json');
      expect(fs.existsSync(configPath)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(parsed.budget.maxTokens).toBeGreaterThan(0);
      expect(parsed.output.format).toBe('xml');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('--init refuses to overwrite an existing repocode.config.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-init-'));
    try {
      const configPath = path.join(tmpDir, 'repocode.config.json');
      fs.writeFileSync(configPath, JSON.stringify({ budget: { maxTokens: 1 } }));
      const result = spawnSync('node', [CLI, tmpDir, '--init'], { encoding: 'utf-8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('already exists');
      // Original content must be untouched
      const raw = fs.readFileSync(configPath, 'utf-8');
      expect(JSON.parse(raw).budget.maxTokens).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('git CLI flags', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cli-git-'));
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "t@t.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "T"', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export const x = 1;\n');
    execSync('git add .', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'pipe' });
    // Unstaged modification
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export const x = 99;\n');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const CLI = path.resolve(__dirname, '../dist/cli.js');  // built CLI entry point

  it('--diff flag produces output containing the changed file', () => {
    const out = execSync(
      `node "${CLI}" "${tmpDir}" --diff --no-security --stdout`,
      { encoding: 'utf-8' }
    );
    expect(out).toContain('index.ts');
  });

  it('--staged flag exits cleanly when nothing is staged', () => {
    // No staged files — output should still be valid XML with 0 files (or empty files list)
    const out = execSync(
      `node "${CLI}" "${tmpDir}" --staged --no-security --stdout`,
      { encoding: 'utf-8' }
    );
    expect(out).toContain('<repocode>');
  });

  it('mutual exclusion: --diff --staged exits with error code 1', () => {
    let exitCode = 0;
    try {
      execSync(
        `node "${CLI}" "${tmpDir}" --diff --staged --no-security`,
        { encoding: 'utf-8', stdio: 'pipe' }
      );
    } catch (err: unknown) {
      exitCode = (err as { status?: number }).status ?? 1;
    }
    expect(exitCode).toBe(1);
  });

  it('--log <n> accepts numeric argument', () => {
    const out = execSync(
      `node "${CLI}" "${tmpDir}" --log 1 --no-security --stdout`,
      { encoding: 'utf-8' }
    );
    expect(out).toContain('<repocode>');
  });

  it('--no-deps flag is accepted without error', () => {
    const out = execSync(
      `node "${CLI}" "${tmpDir}" --diff --no-deps --no-security --stdout`,
      { encoding: 'utf-8' }
    );
    expect(out).toContain('<repocode>');
  });
});
