import { describe, it, expect } from 'vitest';
import { runPipeline, loadConfig } from '../../src/index.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { rankPass1 } from '../../src/ranking/pass1Ranker.js';
import { rankPass2, densityScaleFor } from '../../src/ranking/pass2Ranker.js';
import { extractImportsFromFile } from '../../src/git/importTracer.js';
import type { DiscoveredFile } from '../../src/types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Deliberately NOT *.test.ts: vitest's default include (**\/*.{test,spec}.ts) must never match
 * this file, or a ~60s pack joins every `pnpm test` run and CI's `pnpm -r test` step too.
 * Reached only via `pnpm --filter @repocode/core test:perf` (see vitest.perf.config.ts's own
 * include).
 *
 * Synthetic repo size and threshold per roadmap item 21 ("Pack a synthetic 10k-file repo,
 * assert a wall-clock threshold. Ranking is O(work) — protect it."). The threshold was
 * derived empirically, not guessed: two runs of this exact generator-and-pack logic against
 * the real, unmodified pipeline measured pack durations of 60,698ms and 59,811ms (~1.5%
 * variance) for the 10,000-file repo below. PACK_THRESHOLD_MS is roughly 3x that baseline —
 * generous enough to absorb normal CI-runner variance. This end-to-end gate exercises the
 * whole pipeline as configured below (compress: 'none', security disabled, non-git discovery)
 * — it does NOT exercise the compression tiers, secret scanning, or git-mode import tracing,
 * and a cheap-inner-op quadratic in ranking specifically can hide inside this generous a
 * margin (a 1-4 second regression is invisible against ~120 seconds of slack). The isolated
 * ranking-only gate below exists for exactly that case.
 */
const FILE_COUNT = 10_000;
const HUB_INTERVAL = 100;
const PACK_THRESHOLD_MS = 180_000;
/** Ceiling for the isolated ranking-only gate below. Measured baseline (in-memory, no I/O):
 *  163ms and 184ms across two runs. ~11x that baseline — tighter than PACK_THRESHOLD_MS's 3x
 *  because there's no I/O here to justify a looser margin at this much smaller absolute scale. */
const RANK_THRESHOLD_MS = 2_000;

/** Writes FILE_COUNT synthetic .ts files to `root`: every HUB_INTERVAL-th file is a
 *  dependency-free "hub"; every other file imports its nearest preceding hub plus one more
 *  hub chosen round-robin, giving buildGraph()'s import tracing and the ranking stage's
 *  centrality computation realistic, non-degenerate work to do (a handful of heavily-
 *  depended-on modules, most files importing only a couple of others — not a fully
 *  disconnected or fully-connected graph). */
function generateSyntheticRepo(root: string): void {
  const hubs: number[] = [];
  for (let i = 0; i < FILE_COUNT; i += HUB_INTERVAL) hubs.push(i);

  for (let i = 0; i < FILE_COUNT; i++) {
    const isHub = i % HUB_INTERVAL === 0;
    let content: string;
    if (isHub) {
      content = `export function fn${i}(): number { return ${i}; }\n`;
    } else {
      const nearestHub = hubs[Math.floor(i / HUB_INTERVAL)];
      const distantHub = hubs[i % hubs.length];
      const importLines = [`import { fn${nearestHub} } from './file${nearestHub}.js';`];
      if (distantHub !== nearestHub) {
        importLines.push(`import { fn${distantHub} } from './file${distantHub}.js';`);
      }
      content = `${importLines.join('\n')}\nexport function fn${i}(): number { return fn${nearestHub}() + 1; }\n`;
    }
    fs.writeFileSync(path.join(root, `file${i}.ts`), content);
  }
}

describe('synthetic 10k-file pack (perf regression)', () => {
  it(`packs within ${PACK_THRESHOLD_MS}ms`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-perf-'));
    try {
      generateSyntheticRepo(root); // not timed — this is test setup I/O, not pipeline work

      // Prove the generator's import edges are real, not silently degenerate (e.g. if
      // probeCandidates' resolution ever stops matching this flat layout, buildGraph would
      // return an empty adjacency list and this whole fixture would measure nothing while
      // still passing). Covers both the two-import case (nearest + distant hub differ) and
      // the deduplicated one-import case (nearest === distant hub).
      for (const i of [1, 99, 101, 9999]) {
        const content = fs.readFileSync(path.join(root, `file${i}.ts`), 'utf-8');
        const edges = extractImportsFromFile(`file${i}.ts`, content, root);
        expect(edges.length).toBeGreaterThan(0);
      }

      const config = await loadConfig(root, {
        ...DEFAULT_CONFIG,
        root,
        graphDepth: 2,
        budget: { maxTokens: 1_000_000, reserveForResponse: 0, reserveForPrompt: 0 },
        compress: 'none',
        security: { enabled: false, mode: 'warn' },
      });

      const start = Date.now();
      const result = await runPipeline(config);
      const duration = Date.now() - start;

      process.stdout.write(`[perf] pack of ${FILE_COUNT} files: ${duration}ms (threshold ${PACK_THRESHOLD_MS}ms)\n`);

      expect(result.included.length).toBe(FILE_COUNT);
      expect(duration).toBeLessThan(PACK_THRESHOLD_MS);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it(`ranks ${FILE_COUNT} files in-memory within ${RANK_THRESHOLD_MS}ms`, () => {
    // Isolates rankPass1 + rankPass2 from all I/O (no disk writes, no file reads) so this
    // gate measures only the ranking stage's own complexity — the roadmap's literal target
    // ("Ranking is O(work) — protect it."), which the end-to-end pack test above cannot
    // reliably catch: at 10,000 files, a cheap-inner-op quadratic regression in ranking costs
    // on the order of 1-4 seconds, comfortably inside PACK_THRESHOLD_MS's ~120-second margin
    // over the full pipeline's own ~60-second baseline.
    const files: DiscoveredFile[] = Array.from({ length: FILE_COUNT }, (_, i) => ({
      path: `file${i}.ts`,
      absolutePath: `/synthetic/file${i}.ts`,
      size: 150,
      language: 'typescript',
      mtime: new Date(),
      isBinary: false,
      source: 'normal' as const,
    }));

    const start = Date.now();
    const ranked = rankPass1(files, { keywords: [], pinned: [] });
    rankPass2(ranked, [], new Map(), densityScaleFor(ranked));
    const duration = Date.now() - start;

    expect(ranked.length).toBe(FILE_COUNT);
    expect(duration).toBeLessThan(RANK_THRESHOLD_MS);
  });
});
