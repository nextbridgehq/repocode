import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '../../dist/cli.js');

describe('local-mode output placement (regression guard)', () => {
  it('writes output next to a non-"." target directory, not the invocation cwd', () => {
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-outpath-target-'));
    const invokeFromDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-outpath-invoke-'));
    fs.writeFileSync(path.join(targetDir, 'a.ts'), 'export const x = 1;\n');
    try {
      const result = spawnSync('node', [CLI, targetDir, '--no-security'], { cwd: invokeFromDir, encoding: 'utf-8' });
      expect(result.status).toBe(0);
      expect(fs.existsSync(path.join(targetDir, 'repocode-output.xml'))).toBe(true);
      expect(fs.existsSync(path.join(invokeFromDir, 'repocode-output.xml'))).toBe(false);
    } finally {
      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.rmSync(invokeFromDir, { recursive: true, force: true });
    }
  });

  it('writes to an absolute --output path in plain local mode (previously crashed)', () => {
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-outpath-abs-target-'));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-outpath-abs-out-'));
    fs.writeFileSync(path.join(targetDir, 'a.ts'), 'export const x = 1;\n');
    const absOutPath = path.join(outDir, 'result.xml');
    try {
      const result = spawnSync('node', [CLI, targetDir, '--no-security', '--output', absOutPath], { encoding: 'utf-8' });
      expect(result.status).toBe(0);
      expect(fs.existsSync(absOutPath)).toBe(true);
    } finally {
      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe('--remote output survives temp-dir cleanup — real network', () => {
  it('default output (no --output) is written to the invocation cwd and survives cleanup', () => {
    const invokeFromDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-remote-out-default-'));
    try {
      const result = spawnSync(
        'node',
        [CLI, '--remote', 'octocat/Hello-World', '--remote-branch', 'master', '--no-security'],
        { cwd: invokeFromDir, encoding: 'utf-8' }
      );
      expect(result.status).toBe(0);
      const outPath = path.join(invokeFromDir, 'repocode-output.xml');
      expect(fs.existsSync(outPath)).toBe(true);
      expect(fs.readFileSync(outPath, 'utf-8').length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(invokeFromDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('relative --output is written to the invocation cwd and survives cleanup', () => {
    const invokeFromDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-remote-out-rel-'));
    try {
      const result = spawnSync(
        'node',
        [CLI, '--remote', 'octocat/Hello-World', '--remote-branch', 'master', '--no-security', '--output', 'my-output.xml'],
        { cwd: invokeFromDir, encoding: 'utf-8' }
      );
      expect(result.status).toBe(0);
      const outPath = path.join(invokeFromDir, 'my-output.xml');
      expect(fs.existsSync(outPath)).toBe(true);
      expect(fs.readFileSync(outPath, 'utf-8').length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(invokeFromDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('absolute --output survives cleanup and does not crash', () => {
    const invokeFromDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-remote-out-abs-invoke-'));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-remote-out-abs-target-'));
    const absOutPath = path.join(outDir, 'result.xml');
    try {
      const result = spawnSync(
        'node',
        [CLI, '--remote', 'octocat/Hello-World', '--remote-branch', 'master', '--no-security', '--output', absOutPath],
        { cwd: invokeFromDir, encoding: 'utf-8' }
      );
      expect(result.status).toBe(0);
      expect(fs.existsSync(absOutPath)).toBe(true);
      expect(fs.readFileSync(absOutPath, 'utf-8').length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(invokeFromDir, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }, 30_000);
});
