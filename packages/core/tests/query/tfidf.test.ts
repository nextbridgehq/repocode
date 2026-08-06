import { describe, it, expect } from 'vitest';
import { buildTFIDF, scoreQuery } from '../../src/query/tfidf.js';

describe('TF-IDF', () => {
  it('scores file with query term higher', () => {
    const corpus = [
      { path: 'src/auth.ts', text: 'authenticate user login session token' },
      { path: 'src/utils.ts', text: 'format string pad trim split join' },
    ];
    const tfidf = buildTFIDF(corpus);
    const authScore = scoreQuery('auth token', tfidf, 'src/auth.ts');
    const utilScore = scoreQuery('auth token', tfidf, 'src/utils.ts');
    expect(authScore).toBeGreaterThan(utilScore);
  });

  it('returns 0 for term not in corpus', () => {
    const tfidf = buildTFIDF([{ path: 'a.ts', text: 'hello world' }]);
    expect(scoreQuery('xyznonsense', tfidf, 'a.ts')).toBe(0);
  });
});
