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

describe('runPipeline with a query', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-pipeline-query-'));
    // 40 small files unrelated to the query, then one large file that is the only match.
    for (let i = 0; i < 40; i++) {
      fs.writeFileSync(path.join(tmpDir, `util${i}.py`), `def helper_${i}(x):\n    return x\n`.repeat(20));
    }
    fs.writeFileSync(
      path.join(tmpDir, 'rewrite.py'),
      'def rewrite_assertion(node):\n    """docstring handling for the assertion rewriter"""\n    return node\n'.repeat(120),
    );
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Regression: pass 2 used to divide the query score by file size, so a large file the
  // query ranked first fell below every small unrelated file and missed the candidate cut.
  it('includes a large file the query matches over small unrelated files', async () => {
    const cfg: RepoCodeConfig = {
      ...testConfig,
      root: tmpDir,
      query: 'assertion rewriter docstring',
      budget: { maxTokens: 6000, reserveForResponse: 0, reserveForPrompt: 0 },
      graphDepth: 0,
    };
    const result = await runPipeline(cfg);
    expect(result.included.map(f => f.path)).toContain('rewrite.py');
  });

  // pytest-dev__pytest-5227: the file the query ranked first arrived at 10.8% of its content,
  // because admission spent the whole budget on cheap representations of ~80 other files.
  it('delivers the top-ranked file whole rather than as a fragment', async () => {
    const cfg: RepoCodeConfig = {
      ...testConfig,
      root: tmpDir,
      query: 'assertion rewriter docstring',
      budget: { maxTokens: 6000, reserveForResponse: 0, reserveForPrompt: 0 },
      graphDepth: 0,
    };
    const result = await runPipeline(cfg);
    expect(result.included.find(f => f.path === 'rewrite.py')?.compressionLevel).toBe('none');
  });
});

describe('runPipeline focus on a large file', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-pipeline-focus-'));
    // One module too big for the budget whole, with a single function the query names.
    const fns = Array.from({ length: 60 }, (_, i) =>
      `def step_${i}(x):\n    first = load_${i}(x)\n    second = transform_${i}(first)\n    third = validate_${i}(second)\n    fourth = normalise_${i}(third)\n    fifth = enrich_${i}(fourth)\n    sixth = filter_${i}(fifth)\n    seventh = merge_${i}(sixth, x)\n    eighth = audit_${i}(seventh)\n    return store_${i}(eighth)\n`);
    fns.splice(30, 0, 'def resolve_redirects(resp):\n    LOCATION_HEADER_MARKER = resp.headers["location"]\n    return LOCATION_HEADER_MARKER\n');
    fs.writeFileSync(path.join(tmpDir, 'sessions.py'), fns.join('\n'));
    for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(tmpDir, `util${i}.py`), `def helper_${i}(x):\n    return x\n`.repeat(8));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('delivers the named function of a file that does not fit whole, and omits the rest', async () => {
    const cfg: RepoCodeConfig = {
      ...testConfig,
      root: tmpDir,
      query: 'resolve_redirects drops the location header',
      budget: { maxTokens: 4000, reserveForResponse: 0, reserveForPrompt: 0 },
      graphDepth: 0,
    };
    const file = (await runPipeline(cfg)).included.find(f => f.path === 'sessions.py');
    expect(file?.compressionLevel).toBe('focus');
    expect(file?.content).toContain('LOCATION_HEADER_MARKER = resp.headers');
    expect(file?.content).not.toContain("load_3(x)");
  });

  it('does not use focus without a query', async () => {
    const cfg: RepoCodeConfig = { ...testConfig, root: tmpDir, budget: { maxTokens: 3500, reserveForResponse: 0, reserveForPrompt: 0 }, graphDepth: 0 };
    const levels = (await runPipeline(cfg)).included.map(f => f.compressionLevel);
    expect(levels).not.toContain('focus');
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
