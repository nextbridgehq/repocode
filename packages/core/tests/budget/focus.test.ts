import { describe, it, expect } from 'vitest';
import { buildFocus } from '../../src/budget/focus.js';

const PY = [
  'import os',                                  // 1
  '',                                           // 2
  'class Session:',                             // 3
  '    """A session."""',                       // 4
  '',                                           // 5
  '    def send(self, req):',                   // 6
  '        body = encode(req)',                 // 7
  '        return transmit(body)',              // 8
  '',                                           // 9
  '    def resolve_redirects(self, resp):',     // 10
  '        url = resp.headers["location"]',     // 11
  '        return follow(url)',                 // 12
  '',                                           // 13
  'def helper(a):',                             // 14
  '    total = a + 1',                          // 15
  '    return total',                           // 16
  '',
].join('\n');

describe('buildFocus', () => {
  it('keeps the body of the symbol the query is about and omits the rest', async () => {
    const [focus] = (await buildFocus(PY, 'a.py', 'resolve_redirects loses the location header'))!;
    expect(focus).toContain('url = resp.headers["location"]');
    expect(focus).not.toContain('body = encode(req)');
    expect(focus).not.toContain('total = a + 1');
  });

  it('keeps imports, class headers and every signature', async () => {
    const [focus] = (await buildFocus(PY, 'a.py', 'resolve_redirects'))!;
    for (const kept of ['import os', 'class Session:', 'def send(self, req):', 'def resolve_redirects(self, resp):', 'def helper(a):']) {
      expect(focus).toContain(kept);
    }
  });

  it('replaces an omitted body with one marker that names the original lines', async () => {
    const [focus] = (await buildFocus(PY, 'a.py', 'resolve_redirects'))!;
    expect(focus).toContain('        # ... [2 lines omitted: L7-L8] ...');
    expect(focus).toContain('    # ... [2 lines omitted: L15-L16] ...');
  });

  it('keeps source order', async () => {
    const [focus] = (await buildFocus(PY, 'a.py', 'resolve_redirects'))!;
    expect(focus.indexOf('def send')).toBeLessThan(focus.indexOf('def resolve_redirects'));
    expect(focus.indexOf('def resolve_redirects')).toBeLessThan(focus.indexOf('def helper'));
  });

  it('returns a ladder of growing variants, one more body each step', async () => {
    const src = Array.from({ length: 12 }, (_, i) => `def target_${i}(x):\n    value = x + ${i}\n    first = compute_first(value)\n    second = compute_second(first)\n    third = compute_third(second)\n    return third\n`).join('\n');
    const ladder = (await buildFocus(src, 'a.py', 'target', [1, 3, 8]))!;
    expect(ladder).toHaveLength(3);
    expect(ladder[0].length).toBeLessThan(ladder[1].length);
    expect(ladder[1].length).toBeLessThan(ladder[2].length);
    expect(ladder[0].match(/value = x/g)).toHaveLength(1);
    expect(ladder[1].match(/value = x/g)).toHaveLength(3);
    expect(ladder[2].match(/value = x/g)).toHaveLength(8);
  });

  it('collapses steps that cannot differ when few symbols match', async () => {
    const ladder = (await buildFocus(PY, 'a.py', 'resolve_redirects', [1, 3, 8]))!;
    expect(ladder).toHaveLength(1);
  });

  it('prefers a symbol the query names verbatim over one that merely repeats query words', async () => {
    const src = [
      'def noisy(a):',
      '    # upload upload upload upload upload upload upload',
      '    return upload(a) + upload(a) + upload(a)',
      '',
      'def make_validator(spec):',
      '    return spec',
      '',
    ].join('\n');
    const [focus] = (await buildFocus(src, 'a.py', 'make_validator breaks on upload'))!;
    expect(focus).toContain('return spec');
    expect(focus).not.toContain('upload(a) + upload(a)');
  });

  it('weights the first line of a multi-line query above its body', async () => {
    const src = [
      'def parse_header(h):',
      '    return h',
      '',
      'def read_body(b):',
      '    # crash crash crash crash',
      '    return b',
      '',
    ].join('\n');
    const [focus] = (await buildFocus(src, 'a.py', 'parse_header fails\n\nI see a crash crash crash when reading'))!;
    expect(focus).toContain('return h');
    expect(focus).not.toContain('return b');
  });

  it('uses // markers and keeps the closing brace for brace languages', async () => {
    const ts = [
      'import x from "y";',               // 1
      'export function other(n: number) {', // 2
      '  const a = n * 2;',               // 3
      '  return a;',                      // 4
      '}',                                // 5
      'export function fixTarget(n: number) {', // 6
      '  return n + 1;',                  // 7
      '}',                                // 8
      '',
    ].join('\n');
    const [focus] = (await buildFocus(ts, 'a.ts', 'fixTarget returns the wrong value'))!;
    expect(focus).toContain('return n + 1;');
    expect(focus).toContain('  // ... [2 lines omitted: L3-L4] ...\n}');
    expect(focus).not.toContain('const a = n * 2;');
  });

  it('returns null when nothing in the file matches the query', async () => {
    expect(await buildFocus(PY, 'a.py', 'zzzunrelated qqqnonsense')).toBeNull();
  });

  it('returns null for an unsupported file type', async () => {
    expect(await buildFocus('some text', 'notes.md', 'some')).toBeNull();
  });

  it('is deterministic', async () => {
    expect(await buildFocus(PY, 'a.py', 'send redirects')).toEqual(await buildFocus(PY, 'a.py', 'send redirects'));
  });
});
