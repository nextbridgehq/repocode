import { describe, it, expect } from 'vitest';
import { mentionedPaths, matchesMention } from '../../src/query/locationBoost.js';

describe('mentionedPaths', () => {
  it('reads a path and a dotted module as mentions', () => {
    expect(mentionedPaths('see sklearn/utils/validation.py')).toEqual(['sklearn/utils/validation']);
    expect(mentionedPaths('fails in sklearn.utils.validation')).toEqual(['sklearn/utils/validation']);
  });

  // Reproduction code imports the public module it exercises; that names the API, not the file at fault
  // (benchmark: matplotlib.pyplot pinned pyplot.py to rank 1 on eight matplotlib issues, never the gold file).
  it('ignores a module that is only plainly imported by reproduction code', () => {
    expect(mentionedPaths('### Code\n```python\nimport matplotlib.pyplot as plt\nimport numpy as np\n```')).toEqual([]);
    expect(mentionedPaths('>>> import matplotlib.widgets')).toEqual([]);
  });

  it('keeps a module the prose also names, and from-imports and tracebacks', () => {
    expect(mentionedPaths('import matplotlib.pyplot as plt\nthe bug is in matplotlib.pyplot')).toEqual(['matplotlib/pyplot']);
    expect(mentionedPaths('from sklearn.utils.validation import check_array')).toEqual(['sklearn/utils/validation']);
    expect(mentionedPaths('  File "lib/matplotlib/colors.py", line 3, in f')).toEqual(['lib/matplotlib/colors']);
  });
});

describe('matchesMention', () => {
  it('matches a repo path that ends with the mention, or a package init', () => {
    expect(matchesMention('lib/matplotlib/colors.py', 'matplotlib/colors')).toBe(true);
    expect(matchesMention('sklearn/utils/__init__.py', 'sklearn/utils')).toBe(true);
    expect(matchesMention('lib/matplotlib/cm.py', 'matplotlib/colors')).toBe(false);
  });

  // A traceback names the installed copy, so the mention carries a prefix the repo path lacks
  // (benchmark: matplotlib-24970 and -26020 name their gold file this way and ranked 29th and 82nd).
  it('matches an installed path by its package-relative tail', () => {
    const installed = 'usr/lib/python3.10/site-packages/matplotlib/colors';
    expect(matchesMention('lib/matplotlib/colors.py', installed)).toBe(true);
    expect(matchesMention('lib/mpl_toolkits/axes_grid1/axes_grid.py', 'home/u/envs/lib/python3.7/site-packages/mpl_toolkits/axes_grid1/axes_grid')).toBe(true);
    expect(matchesMention('lib/matplotlib/cm.py', installed)).toBe(false);
    // one shared segment is just a file name, not a package-relative path
    expect(matchesMention('docs/colors.py', installed)).toBe(false);
  });
});
