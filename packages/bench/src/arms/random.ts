import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { isVendored } from './baseline.js';
import type { Retrieval } from '../scoring.js';

const execFileAsync = promisify(execFile);

/**
 * The chance line.
 *
 * Every other non-oracle arm imposes some ordering on the repo, and an ordering can be
 * accidentally hostile to the metric: smallest-first fills the budget with tiny files, and
 * gold patches touch substantial implementation files, so a strategy that maximises file
 * count can still minimise the odds of catching one. Without a floor, a low comparator score
 * is indistinguishable from a comparator that happens to be pathological — and any multiple
 * measured against it is inflated by exactly that much.
 *
 * This arm answers "what does picking at random until the budget is full actually get you?",
 * which is what a stated multiple has to be measured against.
 */

/** mulberry32 — small, fast, and seeded, so a reported floor can be reproduced exactly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleSeeded<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Shuffle, then take every file that still fits. Unlike the ranked arms this keeps going
 *  past a file that does not fit: the question is what a random draw achieves with a full
 *  budget, and stopping early would understate it. */
export function fillRandomly(
  files: Array<{ path: string; size: number }>,
  budget: number,
  seed: number,
): Retrieval[] {
  const selected: Retrieval[] = [];
  let used = 0;
  for (const file of shuffleSeeded(files, seed)) {
    if (used + file.size > budget) continue;
    used += file.size;
    // No compression in this arm, so a selected file is delivered whole.
    selected.push({ path: file.path, chars: file.size });
  }
  return selected;
}

/** Runs `seeds.length` independent draws. Callers should average recall across them —
 *  a single draw is noise. */
export async function runRandom(
  repoDir: string,
  budgetTokens: number,
  seeds: number[] = [1, 2, 3, 4, 5],
): Promise<Retrieval[][]> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-files'], { cwd: repoDir, maxBuffer: 1024 * 1024 * 50 });
    const allFiles = stdout.split('\n').map(f => f.trim()).filter(f => f.length > 0);

    // Same universe as the baseline arm: vendored and data paths excluded, since repocode and
    // repomix both skip them by default. A floor drawn from a different population is not a
    // floor for this comparison.
    const fileSizes: Array<{ path: string; size: number }> = [];
    for (const f of allFiles) {
      if (isVendored(f)) continue;
      try {
        const stats = fs.statSync(path.join(repoDir, f));
        if (stats.isFile()) fileSizes.push({ path: f, size: stats.size });
      } catch {
        // ignore missing/unreadable files
      }
    }

    const budgetChars = budgetTokens * 3.5;
    return seeds.map(seed => fillRandomly(fileSizes, budgetChars, seed));
  } catch (error) {
    console.error(`random arm failed in ${repoDir}`, error);
    return seeds.map(() => []);
  }
}
