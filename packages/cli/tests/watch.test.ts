import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, execSync, type ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '../dist/cli.js');

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-watch-cli-'));
  fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export const x = 1;\n');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function spawnWatch(): ChildProcessWithoutNullStreams {
  return spawn('node', [CLI, tmpDir, '--watch', '--no-security'], { stdio: 'pipe' });
}

async function waitForStderr(proc: ChildProcessWithoutNullStreams, pattern: RegExp, timeoutMs = 20000): Promise<string> {
  let buffer = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${pattern}. Got: ${buffer}`)), timeoutMs);
    proc.stderr.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      if (pattern.test(buffer)) {
        clearTimeout(timer);
        resolve(buffer);
      }
    });
  });
}

describe('repocode --watch', () => {
  it('performs the initial pack and writes the output file', async () => {
    const proc = spawnWatch();
    try {
      await waitForStderr(proc, /Watching/);
      const outPath = path.join(tmpDir, 'repocode-output.xml');
      expect(fs.existsSync(outPath)).toBe(true);
      expect(fs.readFileSync(outPath, 'utf-8')).toContain('index.ts');
    } finally {
      proc.kill('SIGTERM');
    }
  });

  it('writes to an absolute --output path without crashing', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-watch-abs-out-'));
    const absOutPath = path.join(outDir, 'result.xml');
    const proc = spawn('node', [CLI, tmpDir, '--watch', '--no-security', '--output', absOutPath], { stdio: 'pipe' });
    try {
      await waitForStderr(proc, /Watching/);
      expect(fs.existsSync(absOutPath)).toBe(true);
      expect(fs.readFileSync(absOutPath, 'utf-8')).toContain('index.ts');
    } finally {
      proc.kill('SIGTERM');
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('rewrites the output file when a watched file changes', async () => {
    const proc = spawnWatch();
    try {
      await waitForStderr(proc, /Watching/);
      fs.writeFileSync(path.join(tmpDir, 'second.ts'), 'export const y = 2;\n');
      await waitForStderr(proc, /Repacked/, 8000);
      const outPath = path.join(tmpDir, 'repocode-output.xml');
      expect(fs.readFileSync(outPath, 'utf-8')).toContain('second.ts');
    } finally {
      proc.kill('SIGTERM');
    }
  });

  // Windows' child_process.kill() does not deliver real POSIX signals — it force-terminates
  // the child unconditionally, so the SIGTERM handler (and its process.exit(0)) never runs.
  // This graceful-shutdown assertion is only meaningful on POSIX platforms.
  it.skipIf(process.platform === 'win32')('exits cleanly on SIGTERM', async () => {
    const proc = spawnWatch();
    await waitForStderr(proc, /Watching/);
    const exitCode = await new Promise<number | null>((resolve) => {
      proc.on('exit', (code) => resolve(code));
      proc.kill('SIGTERM');
    });
    expect(exitCode).toBe(0);
  });
});

describe('--watch mutual exclusion', () => {
  it('--watch + --dry-run exits 1 with a validation error', () => {
    let exitCode = 0;
    try {
      execSync(`node "${CLI}" "${tmpDir}" --watch --dry-run`, { encoding: 'utf-8', stdio: 'pipe' });
    } catch (err: unknown) {
      exitCode = (err as { status?: number }).status ?? 1;
    }
    expect(exitCode).toBe(1);
  });

  it('--watch + --stdout exits 1 with a validation error', () => {
    let exitCode = 0;
    try {
      execSync(`node "${CLI}" "${tmpDir}" --watch --stdout`, { encoding: 'utf-8', stdio: 'pipe' });
    } catch (err: unknown) {
      exitCode = (err as { status?: number }).status ?? 1;
    }
    expect(exitCode).toBe(1);
  });

  it('--watch + --interactive exits 1 with a validation error', () => {
    let exitCode = 0;
    try {
      execSync(`node "${CLI}" "${tmpDir}" --watch --interactive`, { encoding: 'utf-8', stdio: 'pipe' });
    } catch (err: unknown) {
      exitCode = (err as { status?: number }).status ?? 1;
    }
    expect(exitCode).toBe(1);
  });
});
