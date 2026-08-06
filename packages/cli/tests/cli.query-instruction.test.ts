import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '../dist/cli.js');
const qCLI = `"${CLI}"`;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-query-instr-'));
  fs.writeFileSync(path.join(tmpDir, 'aaa.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(tmpDir, 'zzz.ts'), 'export const b = 1; // widget widget widget factory\n');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function explainScoreFor(file: string, extraArgs: string): number {
  const result = spawnSync('node', [CLI, tmpDir, '--explain', '--no-security', ...extraArgs.split(' ').filter(Boolean)], { encoding: 'utf-8' });
  const line = result.stderr.split('\n').find(l => l.includes(file));
  if (!line) throw new Error(`no ranked row found for ${file} in:\n${result.stderr}`);
  return parseFloat(line.trim().split(/\s+/)[1]);
}

describe('--query', () => {
  it('boosts the score of the file matching the query text', () => {
    const withoutQuery = explainScoreFor('zzz.ts', '');
    const withQuery = explainScoreFor('zzz.ts', '--query "widget factory"');
    expect(withQuery).toBeGreaterThan(withoutQuery);
  });
});

describe('--query-mode', () => {
  it('semantic mode runs without an LLM provider configured (falls back to keyword-only scoring)', () => {
    const result = spawnSync('node', [CLI, tmpDir, '--query', 'widget factory', '--query-mode', 'semantic', '--no-security', '--stdout'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
  });

  it('is a no-op without --query (rerank never runs)', () => {
    const withoutMode = explainScoreFor('zzz.ts', '');
    const withMode = explainScoreFor('zzz.ts', '--query-mode semantic');
    expect(withMode).toBe(withoutMode);
  });
});

describe('--instruction (named)', () => {
  it('renders the named builtin instruction with template variables filled in', () => {
    const out = execSync(`node ${qCLI} "${tmpDir}" --instruction review --no-security --stdout`, { encoding: 'utf-8' });
    expect(out).toContain('Please review this codebase');
    expect(out).not.toContain('{{repo_name}}');
    expect(out).not.toContain('{{files_count}}');
  });

  it('warns and omits <instructions> for an unknown instruction name', () => {
    const result = spawnSync('node', [CLI, tmpDir, '--instruction', 'not-a-real-one', '--no-security', '--stdout'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('unknown instruction name');
    expect(result.stdout).not.toContain('<instructions>');
  });
});

describe('--instruction-file', () => {
  it('includes the literal contents of the given file', () => {
    const instrPath = path.join(tmpDir, 'prompt.md');
    fs.writeFileSync(instrPath, 'Focus only on the public API surface.');
    const out = execSync(`node ${qCLI} "${tmpDir}" --instruction-file "${instrPath}" --no-security --stdout`, { encoding: 'utf-8' });
    expect(out).toContain('Focus only on the public API surface.');
  });
});

describe('--instruction-text', () => {
  it('includes the literal text verbatim', () => {
    const out = execSync(`node ${qCLI} "${tmpDir}" --instruction-text "Be concise and skip boilerplate." --no-security --stdout`, { encoding: 'utf-8' });
    expect(out).toContain('Be concise and skip boilerplate.');
  });
});

describe('deprecated --instruction <path>', () => {
  it('treats a path-like --instruction value as --instruction-file and warns', () => {
    const instrPath = path.join(tmpDir, 'legacy.md');
    fs.writeFileSync(instrPath, 'Legacy instruction file content.');
    const result = spawnSync('node', [CLI, tmpDir, '--instruction', instrPath, '--no-security', '--stdout'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('deprecated');
    expect(result.stdout).toContain('Legacy instruction file content.');
  });
});

describe('--list-instructions', () => {
  it('lists all builtin instructions and exits without packing', () => {
    const result = spawnSync('node', [CLI, tmpDir, '--list-instructions'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    for (const name of ['review', 'explain', 'bugfix', 'refactor', 'security-audit', 'document', 'test']) {
      expect(result.stdout).toContain(name);
    }
    expect(fs.existsSync(path.join(tmpDir, 'repocode-output.xml'))).toBe(false);
  });
});
