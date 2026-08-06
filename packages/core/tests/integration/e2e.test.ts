import { describe, it, expect } from 'vitest';
import { runPipeline, loadConfig } from '../../src/index.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { estimateFast } from '../../src/tokens/fastEstimator.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../fixtures/simple-ts');

describe('end-to-end pipeline', () => {
  it('produces XML output with included files for simple-ts fixture', async () => {
    const config = await loadConfig(FIXTURE, {
      ...DEFAULT_CONFIG,
      root: FIXTURE,
      security: { enabled: false, mode: 'warn' },
    });
    const result = await runPipeline(config);
    expect(result.output).toContain('<repocode>');
    expect(result.included.length).toBeGreaterThan(0);
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it('produces JSON output', async () => {
    const config = await loadConfig(FIXTURE, {
      ...DEFAULT_CONFIG,
      root: FIXTURE,
      output: { ...DEFAULT_CONFIG.output, format: 'json', preamble: false },
      security: { enabled: false, mode: 'warn' },
    });
    const result = await runPipeline(config);
    const parsed = JSON.parse(result.output);
    expect(parsed.files.length).toBeGreaterThan(0);
    expect(parsed.metadata.repository).toBe('simple-ts');
  });

  it('respects token budget', async () => {
    const config = await loadConfig(FIXTURE, {
      ...DEFAULT_CONFIG,
      root: FIXTURE,
      budget: { maxTokens: 100, reserveForResponse: 0, reserveForPrompt: 0 },
      security: { enabled: false, mode: 'warn' },
    });
    const result = await runPipeline(config);
    expect(result.totalTokens).toBeLessThanOrEqual(200); // some overhead tolerance
  });

  it('no-budget includes all non-binary files', async () => {
    const config = await loadConfig(FIXTURE, {
      ...DEFAULT_CONFIG,
      root: FIXTURE,
      budget: { ...DEFAULT_CONFIG.budget, maxTokens: null },
      security: { enabled: false, mode: 'warn' },
    });
    const result = await runPipeline(config);
    expect(result.budget).toBeNull();
    expect(result.included.some(f => f.path.includes('login.ts'))).toBe(true);
  });

  it('outputTokens matches fast estimate of the full output string', async () => {
    const config = await loadConfig(FIXTURE, {
      ...DEFAULT_CONFIG,
      root: FIXTURE,
      security: { enabled: false, mode: 'warn' },
    });
    const result = await runPipeline(config);
    expect(typeof result.outputTokens).toBe('number');
    expect(result.outputTokens).toBe(estimateFast(result.output));
  });

  it('outputTokens is greater than totalTokens (formatting overhead exists)', async () => {
    const config = await loadConfig(FIXTURE, {
      ...DEFAULT_CONFIG,
      root: FIXTURE,
      security: { enabled: false, mode: 'warn' },
    });
    const result = await runPipeline(config);
    expect(result.outputTokens).toBeGreaterThan(result.totalTokens);
  });
});
