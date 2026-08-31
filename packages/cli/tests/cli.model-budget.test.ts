import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(__dirname, '..', 'dist', 'cli.js');

/** A throwaway repo, so the pack has something to rank and a budget to report. */
function fixture(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'cc-model-'));
  fs.writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(join(dir, 'b.ts'), 'export const b = 2;\n');
  return dir;
}

/**
 * `--explain --format json` reports the effective budget as structured data. The plain-text
 * explain table does not print the budget at all, so asserting on scraped stdout would be
 * testing the renderer rather than the resolution being exercised here.
 */
function explainBudget(dir: string, ...args: string[]): number {
  const result = spawnSync(process.execPath, [cliEntry, dir, '--explain', '--format', 'json', ...args], { encoding: 'utf-8' });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.slice(result.stdout.indexOf('{'))).budget.maxTokens;
}

function explain(dir: string, ...args: string[]) {
  return spawnSync(process.execPath, [cliEntry, dir, '--explain', ...args], { encoding: 'utf-8' });
}

describe('--model', () => {
  it('derives a budget from the model context window', () => {
    const dir = fixture();
    try {
      // 1,000,000 context - 128,000 output - 150,000 conversation reserve
      expect(explainBudget(dir, '--model', 'claude-opus-5')).toBe(722_000);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts a short alias', () => {
    const dir = fixture();
    try {
      expect(explainBudget(dir, '--model', 'opus')).toBe(722_000);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lets an explicit --budget win, so --model can be overridden rather than fought', () => {
    const dir = fixture();
    try {
      expect(explainBudget(dir, '--model', 'claude-opus-5', '--budget', '50k')).toBe(50_000);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sizes a small-context model down rather than applying a fixed reserve', () => {
    const dir = fixture();
    try {
      // 200,000 - 64,000 - 30,000. The point of the proportional reserve: a slice sized for
      // a 1M model would leave a 200k model with nothing.
      expect(explainBudget(dir, '--model', 'claude-haiku-4-5')).toBe(106_000);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects an unknown model instead of guessing a budget for it', () => {
    const dir = fixture();
    try {
      const result = explain(dir, '--model', 'gpt-9-ultra');
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('unknown model "gpt-9-ultra"');
      // The error has to be actionable: name the alternatives and the escape hatch.
      expect(result.stderr).toContain('claude-opus-5');
      expect(result.stderr).toContain('--budget');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not reject an unknown model when --no-budget made the budget moot', () => {
    const dir = fixture();
    try {
      const result = explain(dir, '--model', 'gpt-9-ultra', '--no-budget');
      expect(result.status).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
