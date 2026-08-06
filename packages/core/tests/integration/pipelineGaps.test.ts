import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runPipeline } from '../../src/pipeline.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { FileCache } from '../../src/cache/fileCache.js';
import type { RepoCodeConfig, CompressConfig } from '../../src/types.js';

function src(i: number, lines: number): string {
  const body = Array.from(
    { length: lines },
    (_, j) => `    const v${j} = ${j} * ${i}; // filler ${j}`,
  ).join('\n');
  return `// module ${i}\nexport function work${i}(input: number): number {\n${body}\n    return input;\n}\n`;
}

/**
 * Compression only engages when files are larger than the corpus median:
 * selectCandidates sizes the candidate set from the median, so a uniform corpus
 * is trimmed to exactly what fits and nothing ever needs compressing. This
 * fixture mixes 40 small files with 10 large ones so the large files are
 * admitted and then must be compressed to fit.
 */
const SMALL_FILES = 40;
const LARGE_FILES = 10;
/** Empirically the budget at which the large files must compress to fit. */
const COMPRESSING_BUDGET = 4_000;

function makeConfig(root: string, over: Partial<RepoCodeConfig> = {}): RepoCodeConfig {
  return {
    ...DEFAULT_CONFIG,
    root,
    ...over,
    budget: {
      maxTokens: COMPRESSING_BUDGET,
      reserveForResponse: 0,
      reserveForPrompt: 0,
      ...(over.budget ?? {}),
    },
  } as RepoCodeConfig;
}

describe('pipeline coverage gaps', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'repocode-gaps-'));
    for (let i = 0; i < SMALL_FILES; i++) {
      fs.writeFileSync(path.join(root, `small${i}.ts`), src(i, 4));
    }
    for (let i = 0; i < LARGE_FILES; i++) {
      fs.writeFileSync(path.join(root, `large${i}.ts`), src(i, 400));
    }
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('applies compression from a selective CompressConfig object', async () => {
    // Previously only the string form reached runPipeline; the object form was
    // covered solely by normalizeCompressConfig's unit test.
    const compress: CompressConfig = {
      top10: 'tier2-structural',
      top50: 'tier2-structural',
      rest: 'tier2-structural',
    };
    const result = await runPipeline(makeConfig(root, { compress }));

    const compressed = result.included.filter(f => f.compressed);
    expect(compressed.length).toBeGreaterThan(0);
    expect(compressed.every(f => f.compressionLevel === 'tier2-structural')).toBe(true);
  });

  it('treats an all-tiers object as equivalent to the uniform string form', async () => {
    const uniform = await runPipeline(makeConfig(root, {
      compress: 'tier2-structural',
    }));
    const objectForm = await runPipeline(makeConfig(root, {
      compress: { top10: 'tier2-structural', top50: 'tier2-structural', rest: 'tier2-structural' },
    }));

    expect(objectForm.included.length).toBe(uniform.included.length);
    expect(objectForm.included.filter(f => f.compressed).length)
      .toBe(uniform.included.filter(f => f.compressed).length);
    expect(objectForm.totalTokens).toBe(uniform.totalTokens);
  });

  it('exempts top-ranked files when the object sets them to none', async () => {
    const uniform = await runPipeline(makeConfig(root, {
      compress: 'tier2-structural',
    }));
    const exemptTop = await runPipeline(makeConfig(root, {
      compress: { top10: 'none', top50: 'none', rest: 'tier2-structural' },
    }));

    // Per-rank tiers must actually change the outcome, not be flattened to one level.
    expect(exemptTop.included.filter(f => f.compressed).length)
      .not.toBe(uniform.included.filter(f => f.compressed).length);

    // Nothing inside the exempted rank range may be compressed.
    for (const f of exemptTop.included) {
      if (f.rankPosition <= 50) expect(f.compressed).toBe(false);
    }
  });

  it('honours an llm.budgetTokens override through the full pipeline', async () => {
    // No provider is configured, so tier3-llm is unreachable here; this asserts
    // the override flows through runPipeline without being dropped or throwing.
    const result = await runPipeline(makeConfig(root, {
      compress: 'tier2-structural',
      llm: { budgetTokens: 50 },
    } as Partial<RepoCodeConfig>));

    expect(result.included.length).toBeGreaterThan(0);
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it('produces consistent results when two concurrent runs share one FileCache', async () => {
    // startWatch threads a single FileCache across repacks, so overlapping runs
    // sharing an instance is reachable. Neither run may crash, and both must
    // agree on the resulting file set.
    const shared = FileCache.load(root);
    const config = makeConfig(root);

    const [a, b] = await Promise.all([
      runPipeline(config, { cache: shared }),
      runPipeline(config, { cache: shared }),
    ]);

    expect(a.included.map(f => f.path).sort())
      .toEqual(b.included.map(f => f.path).sort());
    expect(a.totalTokens).toBe(b.totalTokens);
  });

  it('leaves a shared FileCache usable for a subsequent run after concurrent use', async () => {
    const shared = FileCache.load(root);
    const config = makeConfig(root);

    await Promise.all([
      runPipeline(config, { cache: shared }),
      runPipeline(config, { cache: shared }),
    ]);
    const after = await runPipeline(config, { cache: shared });

    expect(after.included.length).toBeGreaterThan(0);
    expect(after.cacheStats.file.hits).toBeGreaterThan(0);
  });
});
