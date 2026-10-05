import { describe, it, expect } from 'vitest';
import { extractSymbols } from '../../src/parse/symbols.js';

const brief = (syms: Awaited<ReturnType<typeof extractSymbols>>) =>
  syms!.map(s => `${s.kind}:${s.parent ? s.parent + '.' : ''}${s.name}@${s.startLine}-${s.endLine}/${s.bodyStartLine}`);

describe('extractSymbols', () => {
  it('finds python classes, methods and top-level functions, decorators included', async () => {
    const src = [
      'import os',                       // 1
      '',                                // 2
      'class Foo(Base):',                // 3
      '    """Doc."""',                  // 4
      '    def run(self, x):',           // 5
      '        return x',                // 6
      '',                                // 7
      '    @property',                   // 8
      '    def size(self):',             // 9
      '        return 1',                // 10
      '',                                // 11
      '@cache',                          // 12
      'def helper(a,',                   // 13
      '           b):',                  // 14
      '    return a + b',                // 15
      '',
    ].join('\n');
    expect(brief(await extractSymbols(src, 'a.py'))).toEqual([
      'class:Foo@3-10/4',
      'method:Foo.run@5-6/6',
      'method:Foo.size@8-10/10',
      'function:helper@12-15/15',
    ]);
  });

  it('does not report functions nested inside functions', async () => {
    const src = 'def outer():\n    def inner():\n        pass\n    return inner\n';
    expect(brief(await extractSymbols(src, 'a.py'))).toEqual(['function:outer@1-4/2']);
  });

  it('finds typescript functions, classes, methods, interfaces and arrow-function consts', async () => {
    const src = [
      "import x from 'y';",                         // 1
      'export function a(n: number): number {',    // 2
      '  return n;',                                // 3
      '}',                                          // 4
      'export class K {',                           // 5
      '  m(): void {',                              // 6
      '  }',                                        // 7
      '}',                                          // 8
      'interface I { z: number }',                  // 9
      'export const f = (q: string) => {',          // 10
      '  return q;',                                // 11
      '};',                                         // 12
    ].join('\n');
    expect(brief(await extractSymbols(src, 'a.ts'))).toEqual([
      'function:a@2-4/3',
      'class:K@5-8/6',
      'method:K.m@6-7/7',
      'interface:I@9-9/9',
      'function:f@10-12/11',
    ]);
  });

  it('parses tsx and jsx', async () => {
    const tsx = 'export function C() {\n  return <div>hi</div>;\n}\n';
    expect(brief(await extractSymbols(tsx, 'c.tsx'))).toEqual(['function:C@1-3/2']);
    expect(brief(await extractSymbols(tsx, 'c.jsx'))).toEqual(['function:C@1-3/2']);
  });

  it('finds go functions, methods (parent = receiver type) and types', async () => {
    const src = [
      'package p',                         // 1
      '',                                  // 2
      'type S struct {',                   // 3
      '\tn int',                           // 4
      '}',                                 // 5
      '',                                  // 6
      'func (s *S) Get() int {',           // 7
      '\treturn s.n',                      // 8
      '}',                                 // 9
      '',                                  // 10
      'func New() *S {',                   // 11
      '\treturn &S{}',                     // 12
      '}',                                 // 13
    ].join('\n');
    expect(brief(await extractSymbols(src, 'a.go'))).toEqual([
      'class:S@3-5/4',
      'method:S.Get@7-9/8',
      'function:New@11-13/12',
    ]);
  });

  it('returns null for an unsupported file type', async () => {
    expect(await extractSymbols('# hi', 'README.md')).toBeNull();
    expect(await extractSymbols('fn main() {}', 'a.rs')).toBeNull();
  });

  it('still finds the well-formed symbols around a syntax error', async () => {
    const src = 'def ok():\n    return 1\n\ndef broken(:\n    pass\n\ndef also_ok():\n    return 2\n';
    const names = (await extractSymbols(src, 'a.py'))!.map(s => s.name);
    expect(names).toContain('ok');
    expect(names).toContain('also_ok');
  });

  it('is deterministic and ordered by start line', async () => {
    const src = 'def b():\n    pass\n\ndef a():\n    pass\n';
    const one = await extractSymbols(src, 'a.py');
    const two = await extractSymbols(src, 'a.py');
    expect(one).toEqual(two);
    expect(one!.map(s => s.name)).toEqual(['b', 'a']);
  });

  it('parses a large file quickly', async () => {
    const src = Array.from({ length: 3000 }, (_, i) => `def f${i}(a, b):\n    return a + b + ${i}\n`).join('\n');
    const t0 = Date.now();
    const syms = await extractSymbols(src, 'big.py');
    expect(syms!.length).toBe(3000);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
