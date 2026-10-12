import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { isVendored, fillByBudget } from '../src/arms/baseline.js';
import { selectWithinBudget } from '../src/arms/repomix.js';
import { runOracle } from '../src/arms/oracle.js';
import { isUsableRepo } from '../src/git.js';

describe('isVendored', () => {
  it('flags vendored and data paths that are not the repo\'s own source', () => {
    expect(isVendored('cextern/wcslib/C/flexed/wcsbth.c')).toBe(true);
    expect(isVendored('astropy/utils/iers/data/eopc04_IAU2000.62-now')).toBe(true);
    expect(isVendored('node_modules/left-pad/index.js')).toBe(true);
    expect(isVendored('vendor/github.com/pkg/errors/errors.go')).toBe(true);
  });

  it('does not flag ordinary source files', () => {
    expect(isVendored('astropy/modeling/separable.py')).toBe(false);
    expect(isVendored('astropy/io/fits/fitsrec.py')).toBe(false);
    expect(isVendored('src/index.ts')).toBe(false);
  });
});

describe('budget filling', () => {
  // Both comparison arms skipped past anything that did not fit and kept going, so a bigger
  // budget could admit one large file early and end up with fewer files overall.
  const items = [
    { path: 'a', size: 60 },
    { path: 'b', size: 50 },
    { path: 'c', size: 50 },
  ];

  it('fillByBudget stops at the first file that does not fit', () => {
    expect(fillByBudget(items, 100).map(r => r.path)).toEqual(['a']);
  });

  it('fillByBudget reports the whole file as delivered, since it does not compress', () => {
    expect(fillByBudget(items, 100)).toEqual([{ path: 'a', chars: 60 }]);
  });

  it('fillByBudget is monotone: a larger budget never yields fewer files', () => {
    for (let budget = 0; budget <= 200; budget += 10) {
      const smaller = fillByBudget(items, budget).map(r => r.path);
      const larger = fillByBudget(items, budget + 10).map(r => r.path);
      expect(larger.length).toBeGreaterThanOrEqual(smaller.length);
      expect(smaller.every(p => larger.includes(p))).toBe(true);
    }
  });

  it('selectWithinBudget is monotone in the budget', () => {
    const files = [
      { path: 'x', tokens: 900, chars: 3150 },
      { path: 'y', tokens: 200, chars: 700 },
      { path: 'z', tokens: 200, chars: 700 },
    ];
    for (let budget = 0; budget <= 2000; budget += 100) {
      const smaller = selectWithinBudget(files, budget).map(r => r.path);
      const larger = selectWithinBudget(files, budget + 100).map(r => r.path);
      expect(smaller.every(p => larger.includes(p))).toBe(true);
    }
  });

  it('selectWithinBudget reports the compressed size repomix emitted, not the original', () => {
    const files = [{ path: 'x', tokens: 10, chars: 35 }];
    expect(selectWithinBudget(files, 1000)).toEqual([{ path: 'x', chars: 35 }]);
  });
});

describe('runOracle', () => {
  const sizeOf = (p: string) => ({ 'a/b.py': 350, 'c/d.py': 700 }[p] ?? 0);

  it('returns the gold files whole, so a correct harness can score 100%', () => {
    expect(runOracle(['a/b.py', 'c/d.py'], 100_000, sizeOf))
      .toEqual([{ path: 'a/b.py', chars: 350 }, { path: 'c/d.py', chars: 700 }]);
  });

  it('returns nothing when the budget cannot hold even one gold file', () => {
    expect(runOracle(['a/b.py'], 0, sizeOf)).toEqual([]);
  });

  it('stops once the budget is spent rather than exceeding it', () => {
    // a/b.py costs ceil(350/3.5) = 100 tokens; c/d.py costs 200. Only the first fits in 150.
    expect(runOracle(['a/b.py', 'c/d.py'], 150, sizeOf).map(r => r.path)).toEqual(['a/b.py']);
  });
});

describe('isUsableRepo', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-repo-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects a directory that was never initialised', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.py'), 'x = 1\n');
    expect(isUsableRepo(tmpDir)).toBe(false);
  });

  it('rejects a repo where git init ran but the index was never written', () => {
    // The exact state left behind when `git add .` is interrupted: .git exists, no commits,
    // and a stale lock. ensureRepo used to treat this as a cache hit forever.
    fs.writeFileSync(path.join(tmpDir, 'a.py'), 'x = 1\n');
    execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, '.git', 'index.lock'), '');
    expect(isUsableRepo(tmpDir)).toBe(false);
  });

  it('accepts a repo with a commit and tracked files', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.py'), 'x = 1\n');
    execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
    execFileSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'ignore' });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'x'],
      { cwd: tmpDir, stdio: 'ignore' });
    expect(isUsableRepo(tmpDir)).toBe(true);
  });
});
