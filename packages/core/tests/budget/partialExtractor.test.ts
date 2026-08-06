import { describe, it, expect } from 'vitest';
import { extractTopAndSignatures, extractHunkWindow, extractPartial } from '../../src/budget/partialExtractor.js';
import type { HunkRange } from '../../src/types.js';

// A TypeScript file with 80 lines: 50 lines of imports/constants + 30 lines of functions
function makeFile(topLines: number, funcLines: number): string {
  const top = Array.from({ length: topLines }, (_, i) =>
    `import { thing${i} } from './mod${i}.js';`
  );
  const funcs = Array.from({ length: funcLines }, (_, i) =>
    `function fn${i}(x: string): string { return x; }`
  );
  return [...top, ...funcs].join('\n');
}

describe('extractTopAndSignatures', () => {
  it('returns first 50 lines + signatures for a file with >50 lines', () => {
    const content = makeFile(50, 10); // 60 lines total
    const out = extractTopAndSignatures(content, 'typescript', 50);
    const lines = out.split('\n');
    // First 50 lines present
    expect(lines[0]).toContain('import { thing0 }');
    expect(lines[49]).toContain('import { thing49 }');
    // Signatures of functions present
    expect(out).toContain('function fn0');
    expect(out).toContain('function fn9');
  });

  it('includes omission banner between top block and signatures', () => {
    const content = makeFile(50, 10);
    const out = extractTopAndSignatures(content, 'typescript', 50);
    expect(out).toContain('lines omitted');
  });

  it('returns file unchanged when it has <=50 lines', () => {
    const content = makeFile(10, 5); // 15 lines
    const out = extractTopAndSignatures(content, 'typescript', 50);
    expect(out).toBe(content);
  });
});

describe('extractHunkWindow', () => {
  const CONTENT = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');

  it('includes ±30 lines around a single hunk', () => {
    const hunks: HunkRange[] = [{ start: 50, end: 52 }];
    const out = extractHunkWindow(CONTENT, null, hunks, 30);
    // Window is lines 20-82 (50-30=20, 52+30=82)
    expect(out).toContain('line 20');
    expect(out).toContain('line 82');
  });

  it('merges overlapping windows from multiple adjacent hunks', () => {
    const hunks: HunkRange[] = [
      { start: 10, end: 12 },
      { start: 15, end: 17 }, // close — windows should merge
    ];
    const out = extractHunkWindow(CONTENT, null, hunks, 5);
    // Should not have duplicate omission banners between them
    const banners = (out.match(/lines omitted/g) ?? []).length;
    expect(banners).toBeLessThanOrEqual(2); // at most one before and one after merged window
  });

  it('clamps window to line 1 when hunk is near file start', () => {
    const hunks: HunkRange[] = [{ start: 2, end: 3 }];
    const out = extractHunkWindow(CONTENT, null, hunks, 30);
    expect(out).toContain('line 1');
    expect(out).not.toMatch(/line -/); // no negative line numbers
  });

  it('clamps window to last line when hunk is near file end', () => {
    const hunks: HunkRange[] = [{ start: 98, end: 99 }];
    const out = extractHunkWindow(CONTENT, null, hunks, 30);
    expect(out).toContain('line 100');
  });
});

describe('signature pattern: over-matching guard', () => {
  it('does NOT match bare if/for/while/return call expressions as signatures', () => {
    const content = [
      ...Array.from({ length: 51 }, (_, i) => `import { x${i} } from './m${i}.js';`),
      'if (cond) {',
      'for (let i = 0; i < 10; i++) {',
      'while (true) {',
      'return someFunction(args);',
      'someFunction(args);',
    ].join('\n');
    const out = extractTopAndSignatures(content, 'typescript', 50);
    expect(out).not.toContain('if (cond)');
    expect(out).not.toContain('for (let i');
    expect(out).not.toContain('while (true)');
    expect(out).not.toContain('return someFunction');
    expect(out).not.toContain('someFunction(args)');
  });

  it('DOES match public/private/protected/static method declarations as signatures', () => {
    const content = [
      ...Array.from({ length: 51 }, (_, i) => `import { x${i} } from './m${i}.js';`),
      'public method(x: string): void {',
      'private helper(): void {',
      'static create(): Foo {',
    ].join('\n');
    const out = extractTopAndSignatures(content, 'typescript', 50);
    expect(out).toContain('public method(x: string): void {');
    expect(out).toContain('private helper(): void {');
    expect(out).toContain('static create(): Foo {');
  });

  it('DOES match function declarations as signatures', () => {
    const content = [
      ...Array.from({ length: 51 }, (_, i) => `import { x${i} } from './m${i}.js';`),
      'function foo(x: string): string {',
      'export async function bar(): Promise<void> {',
    ].join('\n');
    const out = extractTopAndSignatures(content, 'typescript', 50);
    expect(out).toContain('function foo(x: string): string {');
    expect(out).toContain('export async function bar(): Promise<void> {');
  });
});

describe('extractPartial dispatch', () => {
  const CONTENT = makeFile(60, 10); // >50 lines

  it('calls extractHunkWindow when hunks are provided', () => {
    const hunks: HunkRange[] = [{ start: 55, end: 55 }];
    const withHunks = extractPartial(CONTENT, 'typescript', hunks);
    const withoutHunks = extractTopAndSignatures(CONTENT, 'typescript');
    // Hunk-based output differs from top+sigs output
    expect(withHunks).not.toBe(withoutHunks);
  });

  it('calls extractTopAndSignatures when no hunks provided', () => {
    const noHunks = extractPartial(CONTENT, 'typescript', undefined);
    const topSigs = extractTopAndSignatures(CONTENT, 'typescript');
    expect(noHunks).toBe(topSigs);
  });
});
