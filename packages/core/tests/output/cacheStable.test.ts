import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runPipeline } from '../../src/pipeline.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import type { RepoCodeConfig } from '../../src/types.js';

/** Phase 2's gate: two packs of an unchanged repo are byte-identical, and one changed file
 *  produces a diff confined to the tail. Both are about prompt-cache reuse, so they are
 *  asserted on the rendered output — the thing actually sent to a model — not on the file list.
 *  Checking the file list alone hid a timestamp in the header that broke caching at byte 1. */
describe('prompt-cache stability', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cache-'));
    for (let i = 0; i < 12; i++) {
      const d = path.join(root, `m${i % 3}`);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, `f${i}.ts`),
        Array.from({ length: 15 }, (_, l) => `export function g${i}_${l}(a: number) { return a + ${l}; }`).join('\n'));
    }
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const cfg = (stableOrder: boolean): RepoCodeConfig => ({
    ...DEFAULT_CONFIG, root,
    output: { ...DEFAULT_CONFIG.output, format: 'xml', preamble: false, stableOrder },
    budget: { maxTokens: 50_000, reserveForResponse: 0, reserveForPrompt: 0 },
    security: { enabled: false, mode: 'warn' },
  });

  it('produces byte-identical output for an unchanged repo', async () => {
    const a = (await runPipeline(cfg(true))).output;
    const b = (await runPipeline(cfg(true))).output;
    expect(b).toBe(a);
  });

  it('keeps the timestamp when stable ordering is off', async () => {
    // The timestamp is genuinely useful; it is dropped only in the mode that trades it away.
    expect((await runPipeline(cfg(false))).output).toMatch(/<generated>/);
    expect((await runPipeline(cfg(true))).output).not.toMatch(/<generated>/);
  });

  it('confines the diff to the tail when one file changes', async () => {
    const before = (await runPipeline(cfg(true))).output;
    fs.appendFileSync(path.join(root, 'm0', 'f0.ts'),
      '\n' + Array.from({ length: 40 }, (_, l) => `export const extra${l} = ${l};`).join('\n'));
    const after = (await runPipeline(cfg(true))).output;

    expect(after).not.toBe(before);
    // The shared prefix has to be a large majority of the pack, which is what a prompt cache
    // is able to reuse. Before stable ordering this was 0%.
    let shared = 0;
    while (shared < before.length && shared < after.length && before[shared] === after[shared]) shared++;
    expect(shared / before.length).toBeGreaterThan(0.5);
  });
});
