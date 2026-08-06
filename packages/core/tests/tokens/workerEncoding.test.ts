import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { estimateAccurateBatch } from '../../src/tokens/accurateEstimator.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-worker-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('estimateAccurateBatch — worker path (>=200 files)', () => {
  it('returns correct token counts for 250 files (triggers worker path)', async () => {
    const filePaths: string[] = [];
    for (let i = 0; i < 250; i++) {
      const fp = path.join(tmpDir, `f${i}.ts`);
      // Each file has the same content so we can verify counts
      fs.writeFileSync(fp, 'export const x = 1;\n', 'utf-8');
      filePaths.push(fp);
    }

    const result = await estimateAccurateBatch(filePaths);

    expect(result.size).toBe(250);
    // Every file has the same content — all counts should be positive and equal
    const counts = [...result.values()];
    expect(counts.every(c => c > 0)).toBe(true);
    const first = counts[0];
    expect(counts.every(c => c === first)).toBe(true);
  }, 45_000); // headroom above WORKER_TIMEOUT_MS (30s) so a slow worker's fallback to sequential encoding has time to finish before the test itself times out

  it('returns correct token counts for 50 files (sequential path, below threshold)', async () => {
    const filePaths: string[] = [];
    for (let i = 0; i < 50; i++) {
      const fp = path.join(tmpDir, `g${i}.ts`);
      fs.writeFileSync(fp, 'export const y = 2;\n', 'utf-8');
      filePaths.push(fp);
    }

    const result = await estimateAccurateBatch(filePaths);

    expect(result.size).toBe(50);
    const counts = [...result.values()];
    expect(counts.every(c => c > 0)).toBe(true);
  });

  it('worker and sequential paths return the same count for identical content', async () => {
    const fp = path.join(tmpDir, 'single.ts');
    fs.writeFileSync(fp, 'export const z = 3;\n', 'utf-8');

    // Sequential (1 file)
    const seqResult = await estimateAccurateBatch([fp]);
    const seqCount = seqResult.get(fp)!;

    // Simulate getting the same count from the worker path by checking
    // that the 250-file result's per-file count matches
    const fp2 = path.join(tmpDir, 'match.ts');
    fs.writeFileSync(fp2, 'export const z = 3;\n', 'utf-8'); // same content
    const filePaths250: string[] = [];
    for (let i = 0; i < 249; i++) {
      const extra = path.join(tmpDir, `extra${i}.ts`);
      fs.writeFileSync(extra, 'export const x = 1;\n', 'utf-8');
      filePaths250.push(extra);
    }
    filePaths250.push(fp2);
    const workerResult = await estimateAccurateBatch(filePaths250);
    expect(workerResult.get(fp2)).toBe(seqCount);
  }, 45_000); // headroom above WORKER_TIMEOUT_MS (30s), same reasoning as the test above
});
