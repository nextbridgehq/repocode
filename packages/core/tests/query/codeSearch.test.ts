import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { tokenize, stem } from '../../src/query/tokenizer.js';
import { buildBM25, scoreBM25 } from '../../src/query/bm25.js';
import { rerank } from '../../src/query/index.js';
import type { RankedFile } from '../../src/types.js';

describe('tokenize — code-aware', () => {
  it('splits camelCase and snake_case identifiers and keeps the whole identifier', () => {
    const t = tokenize('FileUploadPermissions assert_rewrite');
    expect(t).toEqual(expect.arrayContaining(
      ['fileuploadpermissions', 'file', 'upload', 'permissions', 'assert_rewrite', 'assert', 'rewrite'].map(w => w.includes('_') ? w : stem(w)),
    ));
  });

  // Misses in the eval: "rewriting" vs rewrite.py, "evaluation" vs evaluate.py,
  // "skip" vs skipping.py, "caching" vs cache.
  it.each([
    ['rewriting', 'rewrite'], ['evaluation', 'evaluate'], ['skipping', 'skip'],
    ['caching', 'cache'], ['creation', 'create'], ['names', 'name'], ['parsers', 'parser'],
  ])('stems %s and %s to the same term', (a, b) => {
    expect(tokenize(a)).toEqual(tokenize(b));
  });

  it('keeps a whole snake_case identifier unstemmed for exact matching', () => {
    expect(tokenize('get_names')).toContain('get_names');
  });

  it('drops English filler and language keywords that match every file', () => {
    const t = tokenize('when the first expression is used as self in def');
    expect(t).not.toContain('when');
    expect(t).not.toContain('as');
    expect(t).not.toContain('self');
    expect(t).not.toContain('def');
    expect(t).toContain(stem('expression'));
  });
});

describe('BM25', () => {
  it('saturates term frequency: a term-stuffed file is not unboundedly ahead', () => {
    const idx = buildBM25([
      { path: 'stuffed.txt', text: 'upload '.repeat(400) },
      { path: 'real.py', text: 'def upload(): pass\n' + 'x = 1\n'.repeat(20) },
      { path: 'other.py', text: 'def other(): pass' },
    ]);
    const stuffed = scoreBM25(['upload'], idx, 'stuffed.txt');
    const real = scoreBM25(['upload'], idx, 'real.py');
    expect(real).toBeGreaterThan(0);
    expect(stuffed / real).toBeLessThan(3);
  });

  it('scores 0 when no query term occurs', () => {
    const idx = buildBM25([{ path: 'a.py', text: 'hello world' }]);
    expect(scoreBM25(['xyznonsense'], idx, 'a.py')).toBe(0);
  });
});

function makeFile(rel: string, abs: string, score: number): RankedFile {
  return {
    path: rel, absolutePath: abs, size: fs.statSync(abs).size, language: 'python',
    mtime: new Date(0), isBinary: false, source: 'normal', score,
    signalScores: { structural: 0, depth: 0, size: 0, extension: 0, keyword: 0, recency: 0 },
  };
}

const CFG = {
  mode: 'keyword' as const, boostFilename: 3.0, boostExports: 2.5,
  boostImports: 2.0, boostComments: 1.5, maxEmbedFiles: 200,
};

describe('rerank — code search signals', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-codesearch-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const put = (rel: string, content: string, score = 0.5): RankedFile => {
    const abs = path.join(dir, rel.replace(/\//g, '__'));
    fs.writeFileSync(abs, content);
    return makeFile(rel, abs, score);
  };

  // Filler around each file so document frequencies look like a real repo, not three files.
  const filler = (n: number) => Array.from({ length: n }, (_, i) =>
    put(`pkg/mod${i}.py`, `def helper_${i}(file, number):\n    """Handle the first file."""\n    return number\n`, 0.5));

  it('ranks a file whose basename is a rare query term above files matching only common terms', async () => {
    // pytest-dev__pytest-11143: "file" and "first" are everywhere; "rewrite" names the gold file.
    const files = [
      ...filler(30),
      put('src/_pytest/assertion/rewrite.py', 'def rewrite_asserts(mod):\n    """Rewrite the assert statements."""\n    pass\n', 0.3),
      put('scripts/draft-to-file.py', 'def main(file):\n    return file\n', 0.6),
    ];
    const result = await rerank(files, 'Rewrite fails when first expression of file is a number and mistaken as docstring', CFG, dir);
    expect(result[0].path).toBe('src/_pytest/assertion/rewrite.py');
  });

  it('boosts a Python file that defines a symbol named in the query over one that only mentions it', async () => {
    const files = [
      ...filler(20),
      put('app/uses.py', 'from app.core import make_validator\nx = make_validator()\n'),
      put('app/core.py', 'class Base:\n    pass\n\ndef make_validator(spec):\n    return spec\n'),
    ];
    const result = await rerank(files, 'make_validator crashes on empty spec', CFG, dir);
    expect(result[0].path).toBe('app/core.py');
  });

  it('keeps a typical weak match well below a strong one', async () => {
    // psf__requests-1963: "request" occurs in most files, so most files match weakly. Normalising
    // against the median match scored every one of them ~0.5, and the file defining
    // resolve_redirects (0.67) hardly stood out from vendored chardet files.
    const weak = Array.from({ length: 36 }, (_, i) =>
      put(`pkg/mod${i}.py`, `def f_${i}():\n    request = 1\n`, 0.5));
    const mid = Array.from({ length: 4 }, (_, i) =>
      put(`pkg/mid${i}.py`, 'def request(a):\n    request = request(a)\n    return request\n', 0.5));
    const strong = put('pkg/sessions.py', 'def resolve_redirects(request):\n    return request\n', 0.5);
    const result = await rerank([...weak, ...mid, strong], 'resolve_redirects request', { ...CFG, queryWeight: 1 }, dir);
    const score = (p: string) => result.find(f => f.path === p)!.score;
    expect(result[0].path).toBe('pkg/sessions.py');
    expect(score('pkg/mod4.py')).toBeLessThan(0.4);
    expect(score('pkg/sessions.py') - score('pkg/mod4.py')).toBeGreaterThan(0.5);
  });

  // A whole issue is a title plus a body. Body words are mostly incidental, so a file that
  // happens to contain many of them must not outrank the one the title is about.
  it('ranks the file the title is about above a file matching many body words', async () => {
    const bodyWords = ['apple', 'banana', 'cherry', 'damson', 'elder', 'fig', 'grape', 'hazel', 'iris', 'jade', 'kiwi', 'lemon'];
    const files = [
      ...filler(20),
      // Body words recur across the repo, as incidental words in an issue do.
      ...Array.from({ length: 6 }, (_, i) => put(`pkg/misc${i}.py`, bodyWords.map(w => `# ${w}`).join('\n') + '\n', 0.5)),
      put('pkg/target.py', 'def frobnicate(spec):\n    return spec\n', 0.5),
      put('pkg/decoy.py', bodyWords.map(w => `# ${w}`).join('\n') + '\nx = 1\n', 0.5),
    ];
    const query = 'frobnicate fails\n\nWhen I run it I see ' + bodyWords.join(' ') + ' in the log.';
    const result = await rerank(files, query, CFG, dir);
    expect(result[0].path).toBe('pkg/target.py');
  });

  it('puts a file whose path the query names explicitly first', async () => {
    const files = [
      ...filler(20),
      put('sklearn/utils/validation.py', 'def check_array(x):\n    return x\n', 0.2),
      put('sklearn/base.py', 'def check_array_like(x):\n    """check array"""\n    return x\n', 0.8),
    ];
    const result = await rerank(files, 'check_array in sklearn.utils.validation rejects lists', CFG, dir);
    expect(result[0].path).toBe('sklearn/utils/validation.py');
  });

  it('ranks source code above a changelog that mentions every query term', async () => {
    const files = [
      ...filler(20),
      put('doc/en/changelog.rst', 'Fixed docstring rewrite of number expression when first in file.\n'.repeat(30), 0.5),
      put('src/rewrite.py', 'def rewrite(mod):\n    """Rewrite docstring handling."""\n    pass\n', 0.4),
    ];
    const result = await rerank(files, 'Rewrite fails when first expression of file is a number and mistaken as docstring', CFG, dir);
    const src = result.findIndex(f => f.path === 'src/rewrite.py');
    const log = result.findIndex(f => f.path === 'doc/en/changelog.rst');
    expect(src).toBeLessThan(log);
  });
});
