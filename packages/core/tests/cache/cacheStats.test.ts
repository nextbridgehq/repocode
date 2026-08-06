import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runPipeline } from '../../src/pipeline.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { FileCache } from '../../src/cache/fileCache.js';
import type { RepoCodeConfig } from '../../src/types.js';

function makeConfig(root: string): RepoCodeConfig {
  return { ...DEFAULT_CONFIG, root } as RepoCodeConfig;
}

describe('PackResult.cacheStats', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'repocode-cachestats-'));
    for (let i = 0; i < 4; i++) {
      fs.writeFileSync(
        path.join(root, `mod${i}.ts`),
        `export function fn${i}(a: number): number {\n  return a * ${i + 1};\n}\n`,
      );
    }
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reports more file-cache hits on a warm run than a cold one', async () => {
    const cold = await runPipeline(makeConfig(root));

    expect(cold.cacheStats).toBeDefined();
    expect(cold.cacheStats.file.misses).toBeGreaterThan(0);
    expect(cold.cacheStats.file.writes).toBeGreaterThan(0);

    // Note: a cold run is not hit-free. Within a single run the graph builder
    // writes entries that the accurate-token estimator then reads back, so some
    // intra-run hits are expected and correct.

    // Second run over unchanged files: the on-disk cache written by the cold run
    // is reloaded, so strictly more lookups hit and fewer miss.
    const warm = await runPipeline(makeConfig(root));

    expect(warm.cacheStats.file.hits).toBeGreaterThan(cold.cacheStats.file.hits);
    expect(warm.cacheStats.file.misses).toBeLessThan(cold.cacheStats.file.misses);
    expect(warm.cacheStats.file.bytesFromCache).toBeGreaterThan(0);
  });

  it('omits llm and embedding stats when those caches never ran', async () => {
    const result = await runPipeline(makeConfig(root));
    // Default config uses no LLM compression and no semantic query, so reporting
    // zeroed entries would imply they ran and never hit.
    expect(result.cacheStats.llm).toBeUndefined();
    expect(result.cacheStats.embedding).toBeUndefined();
  });

  it('counts a stale entry as a miss, not a hit', async () => {
    await runPipeline(makeConfig(root));

    // Change one file's content: its cached entry is now hash-stale.
    fs.writeFileSync(
      path.join(root, 'mod0.ts'),
      'export function fn0(a: number): number {\n  return a * 999;\n}\n',
    );

    const after = await runPipeline(makeConfig(root));
    expect(after.cacheStats.file.misses).toBeGreaterThan(0);
  });

  it('reports counters scoped to the injected cache instance', async () => {
    // A caller-supplied cache (as startWatch does) must have its own counters
    // reported, not a fresh zeroed set.
    const shared = FileCache.load(root);
    await runPipeline(makeConfig(root), { cache: shared });
    const second = await runPipeline(makeConfig(root), { cache: shared });

    // The same in-memory instance carried entries from run one into run two.
    expect(second.cacheStats.file.hits).toBeGreaterThan(0);
  });
});
