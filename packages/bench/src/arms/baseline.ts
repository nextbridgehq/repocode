import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import type { Retrieval } from '../scoring.js';

const execFileAsync = promisify(execFile);

/** Directory names holding code the repo did not write, or bulk data. Both repocode and
 *  repomix skip these by default, so the baseline has to skip them too — otherwise this arm
 *  measures whether we have ignore rules rather than whether ranking beats picking by size.
 *  On astropy the largest files are a 3.2 MB IERS data table and generated wcslib C, which
 *  consumed the entire budget at every size and made the arm incapable of a hit. */
const SKIP_SEGMENTS = new Set([
  'node_modules', 'vendor', 'vendored', 'third_party', 'thirdparty',
  'cextern', 'extern', 'external', 'dist', 'build',
  'data', 'fixtures', 'testdata',
]);

export function isVendored(filePath: string): boolean {
  return filePath.split('/').some(segment => SKIP_SEGMENTS.has(segment));
}

/** Take files in the given order while they fit, stopping at the first that does not.
 *  Skipping past an oversized file and carrying on makes the result non-monotone: a larger
 *  budget can admit one big file early and end up holding fewer files than a smaller one.
 *
 *  This arm does not compress, so a selected file is delivered whole — `chars` equals its
 *  full size. That is exactly why scoring had to move off path-presence: a compressing arm
 *  was booking a hit for a fragment against this arm's whole files. */
export function fillByBudget(
  files: Array<{ path: string; size: number }>,
  budget: number,
): Retrieval[] {
  const selected: Retrieval[] = [];
  let used = 0;
  for (const file of files) {
    if (used + file.size > budget) break;
    used += file.size;
    selected.push({ path: file.path, chars: file.size });
  }
  return selected;
}

export async function runBaseline(
  repoDir: string,
  budgetTokens: number
): Promise<Retrieval[]> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-files'], { cwd: repoDir, maxBuffer: 1024 * 1024 * 50 });
    const allFiles = stdout.split('\n').map(f => f.trim()).filter(f => f.length > 0);

    // Get file sizes
    const fileSizes: Array<{ path: string, size: number }> = [];
    for (const f of allFiles) {
      if (isVendored(f)) continue;
      const fullPath = path.join(repoDir, f);
      try {
        const stats = fs.statSync(fullPath);
        if (stats.isFile()) {
          fileSizes.push({ path: f, size: stats.size });
        }
      } catch (e) {
        // ignore missing/unreadable files
      }
    }

    // Smallest first: the naive strategy that maximises how many files land inside the budget.
    //
    // Largest-first was the original reading of "largest-N-files-by-size", but it is both
    // degenerate and uncharitable. Degenerate because the single biggest file usually exceeds
    // the budget on its own, so a prefix fill returns nothing; uncharitable because for a
    // file-recall metric, more files is strictly better and largest-first minimises the count.
    // Beating the best naive strategy is the claim worth making — beating a weak one is not.
    fileSizes.sort((a, b) => a.size - b.size || (a.path < b.path ? -1 : 1));

    // Pick until budget hit (approx 3.5 chars per token)
    return fillByBudget(fileSizes, budgetTokens * 3.5);
  } catch (error) {
    console.error(`baseline arm failed in ${repoDir}`, error);
    return [];
  }
}
