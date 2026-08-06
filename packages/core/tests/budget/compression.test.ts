import { describe, it, expect } from 'vitest';
import { compressTier1, compressTier2 } from '../../src/budget/compression.js';

describe('compressTier1', () => {
  it('strips single-line // comments from TypeScript', () => {
    const input = `// This is a comment\nconst x = 1; // inline\nconst y = 2;`;
    const out = compressTier1(input, 'typescript');
    expect(out).not.toContain('// This is a comment');
    expect(out).not.toContain('// inline');
    expect(out).toContain('const x = 1;');
    expect(out).toContain('const y = 2;');
  });

  it('strips # comments from Python', () => {
    const input = `# comment\nx = 1 # inline\ny = 2`;
    const out = compressTier1(input, 'python');
    expect(out).not.toContain('# comment');
    expect(out).not.toContain('# inline');
    expect(out).toContain('x = 1');
  });

  it('strips block comments /* */ from TypeScript', () => {
    const input = `/* block\n   comment */\nconst z = 3;`;
    const out = compressTier1(input, 'typescript');
    expect(out).not.toContain('block');
    expect(out).toContain('const z = 3;');
  });

  it('collapses multiple blank lines to one', () => {
    const input = `a\n\n\n\nb`;
    const out = compressTier1(input, 'typescript');
    expect(out).toBe('a\n\nb');
  });
});

describe('compressTier2', () => {
  it('strips TS function body, keeps signature', () => {
    const input = `function greet(name: string): string {\n  return 'Hello ' + name;\n}`;
    const out = compressTier2(input, 'typescript');
    expect(out).toContain('function greet(name: string): string');
    expect(out).toContain('{ /* ... */ }');
    expect(out).not.toContain("return 'Hello '");
  });

  it('handles nested braces correctly (brace counter)', () => {
    const input = [
      'function f(x: number): object {',
      '  if (x > 0) {',
      '    return { value: x };',
      '  }',
      '  return { value: 0 };',
      '}',
    ].join('\n');
    const out = compressTier2(input, 'typescript');
    expect(out).toContain('function f(x: number): object { /* ... */ }');
    expect(out).not.toContain('if (x > 0)');
  });

  it('strips arrow function body', () => {
    const input = `const double = (x: number): number => {\n  return x * 2;\n};`;
    const out = compressTier2(input, 'typescript');
    expect(out).toContain('{ /* ... */ }');
    expect(out).not.toContain('return x * 2');
  });

  it('leaves TS interface unchanged', () => {
    const input = `interface Foo {\n  id: number;\n  name: string;\n}`;
    const out = compressTier2(input, 'typescript');
    expect(out).toBe(input);
  });

  it('leaves TS import unchanged', () => {
    const input = `import { foo, bar } from './utils.js';`;
    const out = compressTier2(input, 'typescript');
    expect(out).toBe(input);
  });

  it('strips Python function body, keeps def line', () => {
    const input = [
      'def greet(name: str) -> str:',
      '    result = "Hello " + name',
      '    return result',
    ].join('\n');
    const out = compressTier2(input, 'python');
    expect(out).toContain('def greet(name: str) -> str:');
    expect(out).toContain('    ...');
    expect(out).not.toContain('result = "Hello "');
  });

  it('preserves Python type annotation in signature', () => {
    const input = `def process(items: list[str], count: int) -> dict[str, int]:\n    return {}`;
    const out = compressTier2(input, 'python');
    expect(out).toContain('def process(items: list[str], count: int) -> dict[str, int]:');
  });

  it('strips Go function body, keeps func signature', () => {
    const input = [
      'func greet(name string) string {',
      '\treturn "Hello " + name',
      '}',
    ].join('\n');
    const out = compressTier2(input, 'go');
    expect(out).toContain('func greet(name string) string { /* ... */ }');
    expect(out).not.toContain('"Hello "');
  });

  it('cumulative: compressTier2(compressTier1(content)) is smaller than either alone', () => {
    const input = [
      '// This is a long comment that adds tokens',
      '// Another comment',
      'function bigFn(x: string, y: number): Record<string, unknown> {',
      '  const a = x.toUpperCase();',
      '  const b = y * 2;',
      '  return { a, b };',
      '}',
    ].join('\n');
    const t1 = compressTier1(input, 'typescript');
    const t2 = compressTier2(t1, 'typescript');
    expect(t2.length).toBeLessThan(t1.length);
    expect(t2.length).toBeLessThan(input.length);
  });

  it('returns content unchanged for unsupported language', () => {
    const input = 'some content { body }';
    expect(compressTier2(input, 'ruby')).toBe(input);
    expect(compressTier2(input, null)).toBe(input);
  });

  it('does not desync brace counting on a string literal containing a brace', () => {
    const input = [
      'function f(): string {',
      '  const s = "{";',
      '  return s + "}";',
      '}',
    ].join('\n');
    const out = compressTier2(input, 'typescript');
    expect(out).toContain('function f(): string { /* ... */ }');
    expect(out).not.toContain('const s');
  });

  it('does not desync brace counting on a template literal with interpolated braces', () => {
    const input = [
      'function greet(name: string): string {',
      '  return `Hello ${name}, you have ${1 + 1} messages`;',
      '}',
    ].join('\n');
    const out = compressTier2(input, 'typescript');
    expect(out).toContain('function greet(name: string): string { /* ... */ }');
    expect(out).not.toContain('Hello');
  });

  it('does not desync brace counting on a regex literal containing a quantifier brace', () => {
    const input = [
      'function isValid(s: string): boolean {',
      '  return /^[a-z]{2,4}$/.test(s);',
      '}',
    ].join('\n');
    const out = compressTier2(input, 'typescript');
    expect(out).toContain('function isValid(s: string): boolean { /* ... */ }');
    expect(out).not.toContain('a-z');
  });

  it('does not desync brace counting on a single-quoted string containing a brace', () => {
    const input = [
      "function pick(): string {",
      "  return '{';",
      "}",
    ].join('\n');
    const out = compressTier2(input, 'typescript');
    expect(out).toContain('function pick(): string { /* ... */ }');
    expect(out).not.toContain("return '{'");
  });

  it('does not desync on a Go raw string literal ending in a backslash', () => {
    const input = [
      'func f() string {',
      '\treturn `a\\`',
      '}',
    ].join('\n');
    const out = compressTier2(input, 'go');
    expect(out).toContain('func f() string { /* ... */ }');
    expect(out).not.toContain('return `a\\`');
    expect(out.trim()).toBe('func f() string { /* ... */ }');
  });

  it('does not corrupt output when a regex literal contains a quote character', () => {
    // The quotes inside /["']/g are regex content, not string delimiters. The
    // scanner's regex-literal state keeps brace counting in sync, so this body
    // compresses cleanly. Previously the lexer had no regex state, misread the
    // '"' as opening a string, and bailed out via the -1 path leaving the body
    // unstripped — correct but uncompressed.
    const input = [
      'function clean(s: string): string {',
      "  return s.replace(/[\"']/g, '');",
      '}',
    ].join('\n');
    const out = compressTier2(input, 'typescript');

    // No duplication: the return statement must not appear more than once.
    const occurrences = out.split('return s.replace').length - 1;
    expect(occurrences).toBeLessThanOrEqual(1);

    // If the placeholder was emitted, the original body must NOT also be present.
    if (out.includes('{ /* ... */ }')) {
      expect(out).not.toContain('return s.replace');
    }

    expect(out.trim()).toBe('function clean(s: string): string { /* ... */ }');
  });

  it('does not swallow a following function when two regex literals each contain one quote', () => {
    // Regression: with no regex-literal state, the '"' in the first regex opened
    // string-double, which consumed clean()'s closing brace AND shout()'s opening
    // brace. The '"' in the second regex closed that state, so the next '}' took
    // depth to 0 — findMatchingClose returned *shout()'s* closing brace and the
    // whole of shout() was replaced by the placeholder. Silent code loss.
    const input = [
      'function clean(s: string): string {',
      '  return s.replace(/["]/g, "");',
      '}',
      '',
      'function shout(s: string): string {',
      '  return s.replace(/["]/g, "!").toUpperCase();',
      '}',
    ].join('\n');
    const out = compressTier2(input, 'typescript');

    // shout() must still be declared in the output, whatever happened to bodies.
    expect(out).toContain('function shout(s: string): string');
    expect(out).toContain('function clean(s: string): string');
  });

  it('treats a quote inside a regex character class as regex content, not a string', () => {
    const input = [
      'function clean(s: string): string {',
      '  return s.replace(/["\']/g, "");',
      '}',
      'const AFTER = 1;',
    ].join('\n');
    const out = compressTier2(input, 'typescript');
    expect(out).toContain('const AFTER = 1;');
    expect(out).toContain('function clean(s: string): string { /* ... */ }');
  });

  it('handles a forward slash inside a regex character class', () => {
    const input = [
      'function split(p: string): string[] {',
      '  return p.split(/[/]/);',
      '}',
      'const AFTER = 2;',
    ].join('\n');
    const out = compressTier2(input, 'typescript');
    expect(out).toContain('const AFTER = 2;');
    expect(out).toContain('function split(p: string): string[] { /* ... */ }');
  });

  it('handles an escaped forward slash in a regex literal', () => {
    const input = [
      'function isPath(s: string): boolean {',
      '  return /^\\/usr\\/bin/.test(s);',
      '}',
      'const AFTER = 3;',
    ].join('\n');
    const out = compressTier2(input, 'typescript');
    expect(out).toContain('const AFTER = 3;');
    expect(out).toContain('function isPath(s: string): boolean { /* ... */ }');
  });

  it('does not mistake division for a regex literal', () => {
    // `a / b` and `c / d` — if '/' were treated as opening a regex, the span
    // between them would be swallowed and brace counting would desync.
    const input = [
      'function ratio(a: number, b: number, c: number, d: number): number {',
      '  const x = a / b;',
      '  const y = c / d;',
      '  return x + y;',
      '}',
      'const AFTER = 4;',
    ].join('\n');
    const out = compressTier2(input, 'typescript');
    expect(out).toContain('const AFTER = 4;');
    expect(out).toContain('{ /* ... */ }');
    expect(out).not.toContain('const x = a / b');
  });

  it('does not treat division after a closing paren or bracket as a regex', () => {
    const input = [
      'function f(xs: number[]): number {',
      '  return (xs[0] + 1) / xs[1] / 2;',
      '}',
      'const AFTER = 5;',
    ].join('\n');
    const out = compressTier2(input, 'typescript');
    expect(out).toContain('const AFTER = 5;');
    expect(out).toContain('function f(xs: number[]): number { /* ... */ }');
  });

  it('does not treat Go division as a regex literal', () => {
    // Go has no regex literals; '/' is always division there.
    const input = [
      'func ratio(a int, b int) int {',
      '\treturn a / b',
      '}',
      '',
      'func half(a int) int {',
      '\treturn a / 2',
      '}',
    ].join('\n');
    const out = compressTier2(input, 'go');
    expect(out).toContain('func ratio(a int, b int) int { /* ... */ }');
    expect(out).toContain('func half(a int) int { /* ... */ }');
  });

  it('never drops a top-level declaration across generated regex-heavy sources', () => {
    // Property test with a deterministic generator: whatever compressTier2 does
    // to function *bodies*, every top-level declaration must survive. This is the
    // invariant the swallowing bug violated.
    const bodies = [
      'return s.replace(/["]/g, "");',
      "return s.replace(/['\"]/g, '');",
      'return /^[a-z]{2,4}$/.test(s) ? "y" : "n";',
      'return s.split(/[/]/).join("`");',
      'return `${s}`.replace(/[\'"`]/g, "");',
      'return s.length / 2 > 1 ? "{" : "}";',
      'return /\\/(a|b)\\//.test(s) ? \'{\' : `}`;',
      'const re = /["\'`{}]/g; return s.replace(re, "");',
    ];

    // Every ordered pair of bodies, as two adjacent functions.
    for (let a = 0; a < bodies.length; a++) {
      for (let b = 0; b < bodies.length; b++) {
        const src = [
          `function fnA${a}(s: string): string {`,
          `  ${bodies[a]}`,
          '}',
          '',
          `function fnB${b}(s: string): string {`,
          `  ${bodies[b]}`,
          '}',
          '',
          'export const SENTINEL = 42;',
        ].join('\n');

        const out = compressTier2(src, 'typescript');
        const label = `bodies[${a}] + bodies[${b}]`;
        expect(out, label).toContain(`function fnA${a}`);
        expect(out, label).toContain(`function fnB${b}`);
        expect(out, label).toContain('export const SENTINEL = 42;');
      }
    }
  });
});
