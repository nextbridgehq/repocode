import { describe, it, expect } from 'vitest';
import { rerank } from '../../src/query/index.js';
import type { RankedFile } from '../../src/types.js';
import os from 'os';

function makeFile(filePath: string, score: number, content: string): RankedFile {
  return {
    path: filePath, absolutePath: filePath, size: content.length,
    language: 'typescript', mtime: new Date(), isBinary: false,
    source: 'normal', score,
    signalScores: { structural: 0, depth: 0, size: 0, extension: 0, keyword: 0, recency: 0 },
  };
}

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
