import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { filesNamedInIssue } from '../src/arms/repomix.js';

describe('filesNamedInIssue', () => {
  let dir: string;
  const touch = (rel: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), 'x');
  };
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'named-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('finds a repo path written in the issue', () => {
    touch('sklearn/utils/validation.py');
    expect(filesNamedInIssue('crash in sklearn/utils/validation.py line 3', dir)).toEqual(['sklearn/utils/validation.py']);
  });

  it('resolves an installed path in a traceback to the repo file', () => {
    touch('lib/matplotlib/colors.py');
    const issue = 'File "/usr/lib/python3.10/site-packages/matplotlib/colors.py", line 730';
    expect(filesNamedInIssue(issue, dir)).toEqual(['lib/matplotlib/colors.py']);
  });

  it('resolves a dotted module to a file or package init', () => {
    touch('sympy/core/numbers.py');
    touch('sympy/printing/__init__.py');
    expect(filesNamedInIssue('see sympy.core.numbers and sympy.printing', dir).sort())
      .toEqual(['sympy/core/numbers.py', 'sympy/printing/__init__.py']);
  });

  it('ignores names that are not files in the repo, and plain imports', () => {
    touch('lib/matplotlib/pyplot.py');
    expect(filesNamedInIssue('import matplotlib.pyplot as plt\nnp.empty(3) and e.g. v1.2', dir)).toEqual([]);
  });

  it('returns nothing for an issue that names no file', () => {
    touch('a/b.py');
    expect(filesNamedInIssue('it just breaks', dir)).toEqual([]);
  });
});
