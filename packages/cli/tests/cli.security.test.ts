import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '../dist/cli.js');

// AKIAIOSFODNN7EXAMPLE (AWS's own official placeholder key) is built into
// Secretlint's AWS rule as an explicit ignore — it never fires under the
// scanner root uses. Use a non-placeholder key of the same shape instead
// (AKIA + 16 [A-Z0-9] chars), matching packages/core/tests/security/secretScanner.test.ts.
const AWS_KEY = 'AKIA' + 'Z'.repeat(16);
const AWS_KEY_LINE = `const key = "${AWS_KEY}";\n`;
const GITHUB_TOKEN_LINE = 'const token = "ghp_1234567890abcdef1234567890abcdef1234";\n';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-security-'));
  fs.writeFileSync(path.join(tmpDir, 'secret.ts'), AWS_KEY_LINE + GITHUB_TOKEN_LINE);
  fs.writeFileSync(path.join(tmpDir, 'clean.ts'), 'export const clean = 1;\n');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[]) {
  return spawnSync('node', [CLI, tmpDir, ...args, '--stdout'], { encoding: 'utf-8' });
}

describe('--no-security', () => {
  it('skips scanning entirely — secrets pass through verbatim, no warning', () => {
    const result = run(['--no-security']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(AWS_KEY);
    expect(result.stderr).not.toContain('secret');
  });
});

describe('--security-mode warn (default when security is on)', () => {
  it('leaves content untouched but warns on stderr', () => {
    const result = run(['--security-mode', 'warn']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(AWS_KEY);
    expect(result.stderr.toLowerCase()).toContain('secret');
  });
});

describe('--security-mode exclude', () => {
  it('drops the whole offending file from output', () => {
    const result = run(['--security-mode', 'exclude', '--format', 'json']);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.files.some((f: { path: string }) => f.path === 'secret.ts')).toBe(false);
    expect(parsed.files.some((f: { path: string }) => f.path === 'clean.ts')).toBe(true);
  });
});

describe('--security-mode redact', () => {
  it('replaces the matched secret text with [REDACTED] but keeps the file', () => {
    const result = run(['--security-mode', 'redact', '--format', 'json']);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    const secretFile = parsed.files.find((f: { path: string }) => f.path === 'secret.ts');
    expect(secretFile).toBeDefined();
    expect(secretFile.content).toContain('[REDACTED]');
    expect(secretFile.content).not.toContain(AWS_KEY);
  });
});

describe('--security-mode fail', () => {
  it('exits non-zero and writes no output', () => {
    const result = run(['--security-mode', 'fail']);
    expect(result.status).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain('secret');
    expect(result.stdout).toBe('');
  });
});
