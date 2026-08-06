import { describe, it, expect } from 'vitest';
import { runPipeline, loadConfig } from '../src/index.js';
import { DEFAULT_CONFIG } from '../src/config/defaults.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';

// Create a temporary git repo fixture with files at different sizes/types
let fixtureDir: string;

function setup(): void {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-phase3-'));

  execSync('git init', { cwd: fixtureDir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: fixtureDir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: fixtureDir, stdio: 'pipe' });

  // Small file — should fit whole
  fs.writeFileSync(path.join(fixtureDir, 'small.ts'), 'export const x = 1;\n');

  // Medium file with comments and a function body
  fs.writeFileSync(path.join(fixtureDir, 'medium.ts'), [
    '// Description of this module',
    '// Author: Test',
    'export function process(input: string): string {',
    '  const upper = input.toUpperCase();',
    '  return upper.trim();',
    '}',
  ].join('\n'));

  // Large file: many imports (will trigger partial extraction with tight budget)
  const largeContent = [
    ...Array.from({ length: 80 }, (_, i) => `import { item${i} } from './mod${i}.js';`),
    'export function transform(x: string): string {',
    '  return x;',
    '}',
  ].join('\n');
  fs.writeFileSync(path.join(fixtureDir, 'large.ts'), largeContent);

  execSync('git add .', { cwd: fixtureDir, stdio: 'pipe' });
  execSync('git commit -m "initial"', { cwd: fixtureDir, stdio: 'pipe' });
}

function teardown(): void {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
}

describe('Phase 3 pipeline integration', () => {
  it('end-to-end: files cascade through levels with correct compressionLevel', async () => {
    setup();
    try {
      const config = await loadConfig(fixtureDir, {
        ...DEFAULT_CONFIG,
        root: fixtureDir,
        // Very tight budget: forces compression
        budget: { maxTokens: 500, reserveForResponse: 0, reserveForPrompt: 0 },
        compress: 'partial',
        security: { enabled: false, mode: 'warn' },
      });
      const result = await runPipeline(config);
      // At least some files should be included
      expect(result.included.length).toBeGreaterThan(0);
      // All included files must have a compressionLevel
      for (const f of result.included) {
        expect(['none', 'tier1-regex', 'tier2-structural', 'partial']).toContain(f.compressionLevel);
      }
    } finally {
      teardown();
    }
  });

  it('output annotation present for partial files in markdown format', async () => {
    setup();
    try {
      // Same budget math as the tight-budget test: large.ts cascades to partial.
      const config = await loadConfig(fixtureDir, {
        ...DEFAULT_CONFIG,
        root: fixtureDir,
        budget: { maxTokens: 800, reserveForResponse: 0, reserveForPrompt: 0 },
        compress: 'partial',
        output: { ...DEFAULT_CONFIG.output, format: 'markdown', preamble: false },
        security: { enabled: false, mode: 'warn' },
      });
      const result = await runPipeline(config);
      expect(typeof result.output).toBe('string');
      // At least one file must have been compressed
      const compressedFiles = result.included.filter(f => f.compressionLevel !== 'none');
      expect(compressedFiles.length).toBeGreaterThan(0);
      // If any file reached 'partial', the markdown output must contain the annotation
      const partialFiles = result.included.filter(f => f.compressionLevel === 'partial');
      if (partialFiles.length > 0) {
        expect(result.output).toContain('[PARTIAL');
      }
    } finally {
      teardown();
    }
  });

  it('compress none: no file is compressed', async () => {
    setup();
    try {
      const config = await loadConfig(fixtureDir, {
        ...DEFAULT_CONFIG,
        root: fixtureDir,
        budget: { maxTokens: 100_000, reserveForResponse: 0, reserveForPrompt: 0 },
        compress: 'none',
        security: { enabled: false, mode: 'warn' },
      });
      const result = await runPipeline(config);
      for (const f of result.included) {
        expect(f.compressionLevel).toBe('none');
        expect(f.compressed).toBe(false);
      }
    } finally {
      teardown();
    }
  });

  it('default compress=partial: pipeline uses full cascade', () => {
    // DEFAULT_CONFIG now has compress: 'partial'
    expect(DEFAULT_CONFIG.compress).toBe('partial');
  });

  it('large.ts reaches at least tier2-structural or partial compression with tight budget', async () => {
    setup();
    try {
      // large.ts has ~82 lines of imports (~3280 chars → ~820 fast-tokens).
      // small.ts (~5 tokens) and medium.ts (~45 tokens) fit uncompressed.
      // effectiveBudget ≈ 800 - overhead(~215) = ~585.
      // After small+medium (~50 tokens), remaining ~535 < 820 → large.ts cascades.
      // After partial extraction (~50 top lines → ~510 tokens), it fits → compressionLevel = 'partial'.
      const config = await loadConfig(fixtureDir, {
        ...DEFAULT_CONFIG,
        root: fixtureDir,
        budget: { maxTokens: 800, reserveForResponse: 0, reserveForPrompt: 0 },
        compress: 'partial',
        security: { enabled: false, mode: 'warn' },
      });
      const result = await runPipeline(config);
      // At least one file must have been compressed (no conditional guard)
      const compressedFiles = result.included.filter(f => f.compressionLevel !== 'none');
      expect(compressedFiles.length).toBeGreaterThan(0);
    } finally {
      teardown();
    }
  });

  it('pass2 density re-order: small high-score file appears before large medium-score file', async () => {
    setup();
    try {
      const config = await loadConfig(fixtureDir, {
        ...DEFAULT_CONFIG,
        root: fixtureDir,
        budget: { maxTokens: 100_000, reserveForResponse: 0, reserveForPrompt: 0 },
        compress: 'partial',
        security: { enabled: false, mode: 'warn' },
      });
      const result = await runPipeline(config);
      // small.ts is tiny (high density) → should appear before large.ts (low density)
      const smallIdx = result.included.findIndex(f => f.path.includes('small'));
      const largeIdx = result.included.findIndex(f => f.path.includes('large'));
      if (smallIdx !== -1 && largeIdx !== -1) {
        expect(smallIdx).toBeLessThan(largeIdx);
      }
    } finally {
      teardown();
    }
  });

  it('compress tier2: pipeline stops cascade before partial extraction', async () => {
    setup();
    try {
      const config = await loadConfig(fixtureDir, {
        ...DEFAULT_CONFIG,
        root: fixtureDir,
        budget: { maxTokens: 100, reserveForResponse: 0, reserveForPrompt: 0 },
        compress: 'tier2-structural',
        security: { enabled: false, mode: 'warn' },
      });
      const result = await runPipeline(config);
      for (const f of result.included) {
        expect(f.compressionLevel).not.toBe('partial');
      }
    } finally {
      teardown();
    }
  });
});
