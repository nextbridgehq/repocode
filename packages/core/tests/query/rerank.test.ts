import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rerank } from '../../src/query/index.js';
import type { RankedFile } from '../../src/types.js';
import os from 'os';
import fs from 'fs';
import path from 'path';

function makeFile(filePath: string, score: number, content: string): RankedFile {
  return {
    path: filePath, absolutePath: filePath, size: content.length,
    language: 'typescript', mtime: new Date(), isBinary: false,
    source: 'normal', score,
    signalScores: { structural: 0, depth: 0, size: 0, extension: 0, keyword: 0, recency: 0 },
  };
}

const CFG = {
  mode: 'keyword' as const, boostFilename: 3.0, boostExports: 2.5,
  boostImports: 2.0, boostComments: 1.5, maxEmbedFiles: 200,
};

describe('rerank — query must outweigh the generic prior', () => {
  // rerank reads each file's text from absolutePath, so content-based scoring only exercises
  // anything if the files exist. makeFile alone leaves them empty on disk.
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-rerank-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const onDisk = (rel: string, score: number, content: string): RankedFile => {
    const abs = path.join(dir, rel.replace(/\//g, '_'));
    fs.writeFileSync(abs, content);
    return { ...makeFile(rel, score, content), absolutePath: abs };
  };

  it('lifts a query-matching file above a high-prior file that matches nothing', async () => {
    // The shape of the real failure: on django, LICENSE and README (structuralScore 1.0)
    // outranked the file containing the identifier from the query. A query is a statement of
    // task intent; a file that matches it has to beat a file that is merely important-looking.
    const files = [
      onDisk('LICENSE', 0.95, 'Copyright and terms.'),
      onDisk('README.rst', 0.90, 'Project overview.'),
      onDisk('conf/global_settings.py', 0.30,
        'FILE_UPLOAD_PERMISSIONS = None\nFILE_UPLOAD_DIRECTORY_PERMISSIONS = None\n'),
    ];
    const result = await rerank(files, 'Set default FILE_UPLOAD_PERMISSIONS to 0o644', CFG, dir);
    expect(result[0].path).toBe('conf/global_settings.py');
  });

  it('is not collapsed by a single outlier with a huge raw query score', async () => {
    // Normalising by the maximum meant one term-stuffed file drove everyone else toward zero:
    // measured on django, the gold file scored 1.05 against a max of 129.3, so its multiplier
    // was 1.008 — arithmetically no effect at all.
    const stuffed = 'upload permissions '.repeat(400);
    const files = [
      onDisk('tests/fixtures/dump.txt', 0.20, stuffed),
      onDisk('conf/settings.py', 0.30, 'FILE_UPLOAD_PERMISSIONS = None'),
      onDisk('unrelated/widget.py', 0.85, 'def draw(): pass'),
    ];
    const result = await rerank(files, 'FILE_UPLOAD_PERMISSIONS', CFG, dir);
    // The genuine match must still clear the unrelated high-prior file despite the outlier.
    const settings = result.findIndex(f => f.path === 'conf/settings.py');
    const unrelated = result.findIndex(f => f.path === 'unrelated/widget.py');
    expect(settings).toBeLessThan(unrelated);
  });

  it('still uses the prior to break ties between equally irrelevant files', async () => {
    // Query-only ranking measured worse than a blend (rank 164 vs 79), so the prior earns a
    // place as a tie-breaker — it just must not dominate.
    const files = [
      onDisk('src/core.ts', 0.80, 'export function core() {}'),
      onDisk('src/misc.ts', 0.20, 'export function misc() {}'),
    ];
    const result = await rerank(files, 'zzzznomatch', CFG, dir);
    expect(result[0].path).toBe('src/core.ts');
  });
});

describe('rerank', () => {
  it('boosts file whose path matches the query', async () => {
    const files = [
      makeFile('src/utils.ts', 0.5, 'export function format() {}'),
      makeFile('src/auth.ts', 0.4, 'export function authenticate() {}'),
    ];
    // auth.ts has lower base score but matches query term
    const result = await rerank(files, 'auth', { mode: 'keyword', boostFilename: 3.0, boostExports: 2.5, boostImports: 2.0, boostComments: 1.5, maxEmbedFiles: 200 }, os.tmpdir());
    expect(result[0].path).toBe('src/auth.ts');
  });

  it('returns files unchanged when query is empty', async () => {
    const files = [
      makeFile('src/utils.ts', 0.5, 'export function format() {}'),
      makeFile('src/auth.ts', 0.4, 'export function authenticate() {}'),
    ];
    const result = await rerank(files, '  ', { mode: 'keyword', boostFilename: 3.0, boostExports: 2.5, boostImports: 2.0, boostComments: 1.5, maxEmbedFiles: 200 }, os.tmpdir());
    expect(result).toBe(files); // exact same reference
  });

  it('returns files sorted descending by finalScore', async () => {
    const files = [
      makeFile('src/database.ts', 0.3, 'export function query() { return db.run(); }'),
      makeFile('src/auth.ts', 0.5, 'export function authenticate() {}'),
      makeFile('src/router.ts', 0.4, 'export function route() {}'),
    ];
    const result = await rerank(files, 'query database', { mode: 'keyword', boostFilename: 3.0, boostExports: 2.5, boostImports: 2.0, boostComments: 1.5, maxEmbedFiles: 200 }, os.tmpdir());
    // Result should be sorted by score descending
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].score).toBeGreaterThanOrEqual(result[i + 1].score);
    }
  });
});
