import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runPipeline } from '../src/pipeline.js';
import type { RepoCodeConfig } from '../src/types.js';
import { DEFAULT_CONFIG } from '../src/config/defaults.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { FileCache } from '../src/cache/fileCache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures/simple-ts');

const testConfig: RepoCodeConfig = {
  ...DEFAULT_CONFIG,
  root: FIXTURE,
  output: { ...DEFAULT_CONFIG.output, format: 'json', preamble: false },
  budget: { maxTokens: 100_000, reserveForResponse: 4000, reserveForPrompt: 2000 },
  security: { enabled: false, mode: 'warn' },
};

describe('runPipeline', () => {
  it('returns a PackResult with included files', async () => {
    const result = await runPipeline(testConfig);
    expect(result.included.length).toBeGreaterThan(0);
    expect(result.output).toBeTruthy();
  });

  it('output is valid JSON when format is json', async () => {
    const result = await runPipeline(testConfig);
    expect(() => JSON.parse(result.output)).not.toThrow();
    const parsed = JSON.parse(result.output);
    expect(parsed.files.length).toBeGreaterThan(0);
  });

  it('respects --no-budget (null maxTokens) by including all non-binary files', async () => {
    const cfg: RepoCodeConfig = {
      ...testConfig,
      budget: { ...testConfig.budget, maxTokens: null },
    };
    const result = await runPipeline(cfg);
    expect(result.budget).toBeNull();
    expect(result.included.length).toBeGreaterThan(0);
  });
});

describe('runPipeline caching', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-pipeline-cache-'));
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export const x = 1;\n');
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .repocode/cache.json after a run', async () => {
    const cfg: RepoCodeConfig = { ...testConfig, root: tmpDir };
    await runPipeline(cfg);
    expect(fs.existsSync(path.join(tmpDir, '.repocode', 'cache.json'))).toBe(true);
  });

  it('an externally-provided cache instance is reused across calls', async () => {
    const cfg: RepoCodeConfig = { ...testConfig, root: tmpDir };
    const cache = FileCache.load(tmpDir);
    await runPipeline(cfg, { cache });
    const entryAfterFirst = cache.get('index.ts', 'export const x = 1;\n');
    expect(entryAfterFirst?.accurateTokens).toBeDefined();

    await runPipeline(cfg, { cache });
    const entryAfterSecond = cache.get('index.ts', 'export const x = 1;\n');
    expect(entryAfterSecond?.accurateTokens).toBe(entryAfterFirst?.accurateTokens);
  });

  it('deleted files are pruned from the cache after a subsequent run', async () => {
    const cfg: RepoCodeConfig = { ...testConfig, root: tmpDir };
    fs.writeFileSync(path.join(tmpDir, 'temp.ts'), 'export const t = 1;\n');
    await runPipeline(cfg);
    let parsed = JSON.parse(fs.readFileSync(path.join(tmpDir, '.repocode', 'cache.json'), 'utf-8'));
    expect(parsed.files['temp.ts']).toBeDefined();

    fs.unlinkSync(path.join(tmpDir, 'temp.ts'));
    await runPipeline(cfg);
    parsed = JSON.parse(fs.readFileSync(path.join(tmpDir, '.repocode', 'cache.json'), 'utf-8'));
    expect(parsed.files['temp.ts']).toBeUndefined();
  });
});
