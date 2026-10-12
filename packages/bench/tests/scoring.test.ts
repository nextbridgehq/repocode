import { describe, it, expect } from 'vitest';
import { scoreRecall, parsePatchHunks, scoreHunks } from '../src/scoring.js';

// gold file is 1000 chars on disk
const sizes = (p: string) => ({ 'a.py': 1000, 'b.py': 400 }[p] ?? 0);

describe('scoreRecall', () => {
  it('counts a whole-file retrieval as found', () => {
    const r = scoreRecall(['a.py'], [{ path: 'a.py', chars: 1000 }], sizes, 0.5);
    expect(r.found).toBe(1);
    expect(r.pct).toBe(100);
  });

  it('does not count a stub that falls below the retention bar', () => {
    // 110 of 1000 chars — the ~11% signature the fitter was actually producing
    const r = scoreRecall(['a.py'], [{ path: 'a.py', chars: 110 }], sizes, 0.5);
    expect(r.found).toBe(0);
    expect(r.pct).toBe(0);
  });

  it('counts a partial retrieval that clears the bar', () => {
    const r = scoreRecall(['a.py'], [{ path: 'a.py', chars: 600 }], sizes, 0.5);
    expect(r.found).toBe(1);
  });

  it('treats the bar as inclusive', () => {
    expect(scoreRecall(['a.py'], [{ path: 'a.py', chars: 500 }], sizes, 0.5).found).toBe(1);
  });

  it('reproduces path-recall at a zero bar, so old numbers stay comparable', () => {
    const r = scoreRecall(['a.py'], [{ path: 'a.py', chars: 1 }], sizes, 0);
    expect(r.found).toBe(1);
  });

  it('a file absent from the selection is never found, whatever the bar', () => {
    expect(scoreRecall(['a.py'], [{ path: 'b.py', chars: 400 }], sizes, 0).found).toBe(0);
  });

  it('scores multiple gold files independently', () => {
    const r = scoreRecall(
      ['a.py', 'b.py'],
      [{ path: 'a.py', chars: 900 }, { path: 'b.py', chars: 40 }],
      sizes, 0.5,
    );
    expect(r.found).toBe(1); // a.py clears, b.py at 10% does not
    expect(r.total).toBe(2);
    expect(r.pct).toBe(50);
  });

  it('does not credit a file the arm reported as larger than the original', () => {
    // Guards against an arm double-counting or reporting the wrong unit; retention caps at 1.
    const r = scoreRecall(['a.py'], [{ path: 'a.py', chars: 99999 }], sizes, 0.5);
    expect(r.found).toBe(1);
    expect(r.retentions['a.py']).toBe(1);
  });

  it('reports 100% for an instance with no gold files rather than dividing by zero', () => {
    expect(scoreRecall([], [], sizes, 0.5).pct).toBe(100);
  });
});

const PATCH = [
  'diff --git a/pkg/a.py b/pkg/a.py',
  '--- a/pkg/a.py',
  '+++ b/pkg/a.py',
  '@@ -10,6 +10,6 @@ def f():',
  '     keep = 1',
  '-    value = compute(first)',
  '-    other = compute(second)',
  '+    value = better(first)',
  '     tail = 2',
  '@@ -40,3 +40,4 @@ def g():',
  '     alpha = load()',
  '+    beta = save()',
  '     gamma = done()',
  '\\ No newline at end of file',
  'diff --git a/pkg/b.py b/pkg/b.py',
  '--- a/pkg/b.py',
  '+++ b/pkg/b.py',
  '@@ -1,2 +1,2 @@',
  '-import old_module',
  '+import new_module',
].join('\n');

describe('parsePatchHunks', () => {
  it('keeps the removed lines of each hunk, per file', () => {
    expect(parsePatchHunks(PATCH)).toEqual({
      'pkg/a.py': [['value = compute(first)', 'other = compute(second)'], ['alpha = load()', 'gamma = done()']],
      'pkg/b.py': [['import old_module']],
    });
  });

  it('uses the context lines for a hunk that only adds', () => {
    // second hunk of pkg/a.py above: nothing removed, so the surrounding lines locate it
    expect(parsePatchHunks(PATCH)['pkg/a.py'][1]).toEqual(['alpha = load()', 'gamma = done()']);
  });
});

describe('scoreHunks', () => {
  const hunks = [['value = compute(first)', 'other = compute(second)'], ['import old_module']];

  it('counts a hunk whose lines are present, ignoring indentation', () => {
    const content = 'def f():\n        value = compute(first)\n  other = compute(second)\n';
    expect(scoreHunks(hunks, content)).toEqual({ covered: 1, total: 2 });
  });

  it('does not count a hunk when most of its lines are missing', () => {
    const content = 'value = compute(first)\n';
    expect(scoreHunks([['value = compute(first)', 'a = 1 + 1', 'b = 2 + 2', 'c = 3 + 3', 'd = 4 + 4']], content))
      .toEqual({ covered: 0, total: 1 });
  });

  it('is zero for empty content and full for the whole file', () => {
    expect(scoreHunks(hunks, '')).toEqual({ covered: 0, total: 2 });
    expect(scoreHunks(hunks, 'value = compute(first)\nother = compute(second)\nimport old_module\n'))
      .toEqual({ covered: 2, total: 2 });
  });

  it('ignores one-token punctuation lines so they cannot match by accident', () => {
    expect(scoreHunks([['}', 'real_call(x)']], '}\n')).toEqual({ covered: 0, total: 1 });
  });
});
