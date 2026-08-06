import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ContentHashCache } from '../../src/utils/contentCache.js';

let tmpDir: string;
beforeAll(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cache-')); });
afterAll(() => { fs.rmSync(tmpDir, { recursive: true }); });

describe('ContentHashCache', () => {
  it('returns undefined for unknown content', () => {
    const cache = new ContentHashCache<string>(tmpDir, 'test');
    expect(cache.get('hello')).toBeUndefined();
  });

  it('stores and retrieves a value', () => {
    const cache = new ContentHashCache<string>(tmpDir, 'test2');
    cache.set('hello', 'world');
    expect(cache.get('hello')).toBe('world');
  });

  it('persists across instances after save()', () => {
    const c1 = new ContentHashCache<number[]>(tmpDir, 'persist');
    c1.set('vec', [1, 2, 3]);
    c1.save();
    const c2 = new ContentHashCache<number[]>(tmpDir, 'persist');
    expect(c2.get('vec')).toEqual([1, 2, 3]);
  });

  it('different content returns different entries', () => {
    const cache = new ContentHashCache<string>(tmpDir, 'diff');
    cache.set('a', 'val-a');
    cache.set('b', 'val-b');
    expect(cache.get('a')).toBe('val-a');
    expect(cache.get('b')).toBe('val-b');
  });
});
