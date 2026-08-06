import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '../dist/cli.js');
const qCLI = `"${CLI}"`;

// A single-file fixture whose token math is deterministic (fast estimator = ceil(len/4)):
//   original ≈ 79 tokens, tier1 (comment stripped) ≈ 58 tokens, tier2 (body collapsed) ≈ 16 tokens.
// With default reserves (4000 response + 2000 prompt) and ~55 tokens of single-file overhead,
// effectiveBudget = --budget - 6055. Two budgets below sit in the windows verified empirically:
//   6120 -> remaining 65  (fits tier1, not the 79-token original)
//   6090 -> remaining 35  (fits tier2, not the 58-token tier1 output)
const FIXTURE_SOURCE = `// Leading comment describing the module in detail for tier1 stripping purposes
export function processData(input: string): string {
  const trimmed = input.trim();
  const upper = trimmed.toUpperCase();
  const withPrefix = 'PROCESSED_' + upper;
  const withSuffix = withPrefix + '_DONE';
  return withSuffix;
}
`;
const BUDGET_TIER1_WINDOW = 6120;
const BUDGET_TIER2_WINDOW = 6090;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-compress-'));
  fs.writeFileSync(path.join(tmpDir, 'mod.ts'), FIXTURE_SOURCE);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function packJson(args: string): { path: string; compressionLevel: string; content: string }[] {
  const out = execSync(`node ${qCLI} "${tmpDir}" ${args} --no-security --format json --stdout`, { encoding: 'utf-8' });
  return JSON.parse(out).files;
}

describe('--compress (default: partial)', () => {
  it('cascades to tier1-regex once the whole file no longer fits', () => {
    const files = packJson(`--budget ${BUDGET_TIER1_WINDOW}`);
    expect(files).toHaveLength(1);
    expect(files[0].compressionLevel).toBe('tier1-regex');
    expect(files[0].content).not.toContain('Leading comment');
    expect(files[0].content).toContain('processData');
  });

  it('cascades further to tier2-structural once tier1 output no longer fits', () => {
    const files = packJson(`--budget ${BUDGET_TIER2_WINDOW}`);
    expect(files).toHaveLength(1);
    expect(files[0].compressionLevel).toBe('tier2-structural');
    expect(files[0].content).toContain('{ /* ... */ }');
    expect(files[0].content).not.toContain('trimmed.toUpperCase');
  });
});

describe('--compress tier1', () => {
  it('applies tier1 when it is enough to fit', () => {
    const files = packJson(`--budget ${BUDGET_TIER1_WINDOW} --compress tier1`);
    expect(files[0].compressionLevel).toBe('tier1-regex');
  });

  it('excludes the file rather than escalating to tier2 when tier1 alone does not fit', () => {
    const files = packJson(`--budget ${BUDGET_TIER2_WINDOW} --compress tier1`);
    expect(files).toHaveLength(0);
  });
});

describe('--compress tier2', () => {
  it('applies tier2 (same result as the default cascade at this budget)', () => {
    const files = packJson(`--budget ${BUDGET_TIER2_WINDOW} --compress tier2`);
    expect(files[0].compressionLevel).toBe('tier2-structural');
  });
});

describe('--compress none / --no-compress', () => {
  it('--compress none excludes the file rather than compressing it', () => {
    const files = packJson(`--budget ${BUDGET_TIER1_WINDOW} --compress none`);
    expect(files).toHaveLength(0);
  });

  it('--no-compress is equivalent to --compress none', () => {
    const files = packJson(`--budget ${BUDGET_TIER1_WINDOW} --no-compress`);
    expect(files).toHaveLength(0);
  });
});
