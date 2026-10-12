import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import lockfile from 'proper-lockfile';
import { FileCache } from '../../src/cache/fileCache.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cache-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('FileCache', () => {
  it('load() returns an empty cache when no cache file exists', () => {
    const cache = FileCache.load(tmpDir);
    expect(cache.get('a.ts', 'content')).toBeUndefined();
  });

  it('load() returns an empty cache when the cache file is corrupt JSON', () => {
    fs.mkdirSync(path.join(tmpDir, '.repocode'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.repocode', 'cache.json'), '{ not valid json', 'utf-8');
    const cache = FileCache.load(tmpDir);
    expect(cache.get('a.ts', 'content')).toBeUndefined();
  });

  it('load() returns an empty cache when the version field does not match', () => {
    fs.mkdirSync(path.join(tmpDir, '.repocode'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.repocode', 'cache.json'),
      JSON.stringify({ version: 99, files: {} }),
      'utf-8'
    );
    const cache = FileCache.load(tmpDir);
    expect(cache.get('a.ts', 'content')).toBeUndefined();
  });

  it('get() returns undefined for a path with no entry', () => {
    const cache = FileCache.load(tmpDir);
    expect(cache.get('missing.ts', 'x')).toBeUndefined();
  });

  it('set() then get() with the same content returns the stored entry', () => {
    const cache = FileCache.load(tmpDir);
    cache.set('a.ts', 'const a = 1;', { accurateTokens: 5 });
    const entry = cache.get('a.ts', 'const a = 1;');
    expect(entry?.accurateTokens).toBe(5);
  });

  it('get() returns undefined when content has changed (hash mismatch)', () => {
    const cache = FileCache.load(tmpDir);
    cache.set('a.ts', 'const a = 1;', { accurateTokens: 5 });
    expect(cache.get('a.ts', 'const a = 2;')).toBeUndefined();
  });

  it('set() merges fields when content is unchanged', () => {
    const cache = FileCache.load(tmpDir);
    cache.set('a.ts', 'const a = 1;', { accurateTokens: 5 });
    cache.set('a.ts', 'const a = 1;', { imports: ['b.ts'] });
    const entry = cache.get('a.ts', 'const a = 1;');
    expect(entry?.accurateTokens).toBe(5);
    expect(entry?.imports).toEqual(['b.ts']);
  });

  it('set() replaces the entry fresh when content has changed (stale fields dropped)', () => {
    const cache = FileCache.load(tmpDir);
    cache.set('a.ts', 'const a = 1;', { accurateTokens: 5, imports: ['b.ts'] });
    cache.set('a.ts', 'const a = 2;', { accurateTokens: 7 });
    const entry = cache.get('a.ts', 'const a = 2;');
    expect(entry?.accurateTokens).toBe(7);
    expect(entry?.imports).toBeUndefined();
  });

  it('prune() removes entries not in the live path set', () => {
    const cache = FileCache.load(tmpDir);
    cache.set('a.ts', 'const a = 1;', { accurateTokens: 5 });
    cache.set('b.ts', 'const b = 1;', { accurateTokens: 3 });
    cache.prune(new Set(['a.ts']));
    expect(cache.get('a.ts', 'const a = 1;')).toBeDefined();
    expect(cache.get('b.ts', 'const b = 1;')).toBeUndefined();
  });

  it('save() writes the cache file to .repocode/cache.json', () => {
    const cache = FileCache.load(tmpDir);
    cache.set('a.ts', 'const a = 1;', { accurateTokens: 5 });
    cache.save();
    const cachePath = path.join(tmpDir, '.repocode', 'cache.json');
    expect(fs.existsSync(cachePath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    expect(parsed.version).toBe(3);
    expect(parsed.files['a.ts'].accurateTokens).toBe(5);
  });

  it('save() is a no-op when the cache was never modified', () => {
    const cache = FileCache.load(tmpDir);
    cache.save();
    const cachePath = path.join(tmpDir, '.repocode', 'cache.json');
    expect(fs.existsSync(cachePath)).toBe(false);
  });

  it('a freshly loaded cache reflects entries saved by a previous instance', () => {
    const cache1 = FileCache.load(tmpDir);
    cache1.set('a.ts', 'const a = 1;', { accurateTokens: 5 });
    cache1.save();

    const cache2 = FileCache.load(tmpDir);
    expect(cache2.get('a.ts', 'const a = 1;')?.accurateTokens).toBe(5);
  });

  it('cache keys use forward slashes regardless of separator passed in', () => {
    const cache = FileCache.load(tmpDir);
    cache.set('src\\auth\\login.ts', 'const x = 1;', { accurateTokens: 2 });
    cache.save();
    const cachePath = path.join(tmpDir, '.repocode', 'cache.json');
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    expect(Object.keys(parsed.files)).toContain('src/auth/login.ts');
  });
});

describe('FileCache concurrent writes', () => {
  // tmpDir comes from the existing beforeEach/afterEach at the top of this file,
  // which creates it under os.tmpdir() — the same convention every other
  // filesystem-touching test here uses.

  it('preserves a concurrent instance entries instead of clobbering them', () => {
    const a = FileCache.load(tmpDir);
    const b = FileCache.load(tmpDir);

    a.set('a.ts', 'content-a', { accurateTokens: 1 });
    b.set('b.ts', 'content-b', { accurateTokens: 2 });

    a.save();
    b.save(); // b loaded before a wrote; it must not erase a.ts

    const reloaded = FileCache.load(tmpDir);
    expect(reloaded.get('a.ts', 'content-a')).toBeDefined();
    expect(reloaded.get('b.ts', 'content-b')).toBeDefined();
  });

  it('writes through a rename so readers never see a partial file', () => {
    const cache = FileCache.load(tmpDir);
    cache.set('a.ts', 'content-a', { accurateTokens: 1 });

    const renameSpy = vi.spyOn(fs, 'renameSync');
    cache.save();

    const cacheRenames = renameSpy.mock.calls.filter(c => String(c[1]).endsWith('cache.json'));
    expect(cacheRenames.length).toBeGreaterThan(0);
    renameSpy.mockRestore();
  });

  // On Windows, renaming over cache.json fails with EPERM while another process has it open for
  // reading, and readers do not take the lock. Seen as a failed pack when two repocode processes
  // (the MCP test files, sharing one fixture) ran against the same repository at once.
  it('does not fail the pack when the cache file is held open by another process', () => {
    const cache = FileCache.load(tmpDir);
    cache.set('a.ts', 'content-a', { accurateTokens: 1 });

    const eperm = Object.assign(new Error("EPERM: operation not permitted, rename 'x'"), { code: 'EPERM' });
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw eperm; });
    const messages: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((msg: string | Uint8Array) => {
      messages.push(String(msg));
      return true;
    });

    expect(() => cache.save()).not.toThrow();

    renameSpy.mockRestore();
    stderrSpy.mockRestore();
    expect(messages.join('')).toMatch(/could not write cache/i);
    // Nothing was written, and the entry is still pending for the next save.
    cache.save();
    expect(FileCache.load(tmpDir).get('a.ts', 'content-a')).toBeDefined();
  });

  it('retries a transient rename failure before giving up', () => {
    const cache = FileCache.load(tmpDir);
    cache.set('a.ts', 'content-a', { accurateTokens: 1 });

    const real = fs.renameSync.bind(fs);
    let calls = 0;
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      real(from, to);
    });

    cache.save();
    renameSpy.mockRestore();

    expect(calls).toBeGreaterThan(1);
    expect(FileCache.load(tmpDir).get('a.ts', 'content-a')).toBeDefined();
  });

  it('skips the write with a warning when the lock is already held', () => {
    fs.mkdirSync(path.join(tmpDir, '.repocode'), { recursive: true });
    const cachePath = path.join(tmpDir, '.repocode', 'cache.json');
    const release = lockfile.lockSync(cachePath, { realpath: false, stale: 10_000 });

    const messages: string[] = [];
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((msg: string | Uint8Array) => {
        messages.push(String(msg));
        return true;
      });

    const cache = FileCache.load(tmpDir);
    cache.set('a.ts', 'content-a', { accurateTokens: 1 });
    cache.save(); // exhausts the retry window (~1.8s) and gives up

    stderrSpy.mockRestore();
    release();

    expect(messages.join('')).toContain('could not acquire cache lock');
    // Packing must still succeed; the cache write is simply skipped.
    expect(fs.existsSync(cachePath)).toBe(false);
  }, 10_000); // generous timeout: this test deliberately waits out the retry window

  it('fails fast with the real error when the lock error is not contention (e.g. EACCES)', () => {
    fs.mkdirSync(path.join(tmpDir, '.repocode'), { recursive: true });
    const cachePath = path.join(tmpDir, '.repocode', 'cache.json');

    const lockSpy = vi.spyOn(lockfile, 'lockSync').mockImplementation(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });

    const messages: string[] = [];
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((msg: string | Uint8Array) => {
        messages.push(String(msg));
        return true;
      });

    const cache = FileCache.load(tmpDir);
    cache.set('a.ts', 'content-a', { accurateTokens: 1 });
    expect(() => cache.save()).not.toThrow();

    stderrSpy.mockRestore();
    lockSpy.mockRestore();

    const joined = messages.join('');
    expect(joined).toContain('EACCES');
    expect(joined).not.toContain('could not acquire cache lock');
    // Must not sleep through the six-attempt retry schedule (~1.8s) for a
    // non-contention error.
    expect(lockSpy.mock.calls.length).toBeLessThanOrEqual(2);
    // Packing must still succeed; the cache write is simply skipped.
    expect(fs.existsSync(cachePath)).toBe(false);
  });

  it('still prunes dead entries in the normal single-process case', () => {
    const cache = FileCache.load(tmpDir);
    cache.set('alive.ts', 'x', { accurateTokens: 1 });
    cache.set('dead.ts', 'y', { accurateTokens: 1 });
    cache.save();

    const second = FileCache.load(tmpDir);
    second.set('alive.ts', 'x', { accurateTokens: 1 });
    second.prune(new Set(['alive.ts']));
    second.save();

    const reloaded = FileCache.load(tmpDir);
    expect(reloaded.get('alive.ts', 'x')).toBeDefined();
    expect(reloaded.get('dead.ts', 'y')).toBeUndefined();
  });

  it('does not prune a key that a concurrent process updated after the prune snapshot', () => {
    // Seed the on-disk cache with two live keys, X and Y.
    const seed = FileCache.load(tmpDir);
    seed.set('x.ts', 'content-x', { accurateTokens: 1 });
    seed.set('y.ts', 'content-y-old', { accurateTokens: 2 });
    seed.save();

    // A and B both load the same on-disk snapshot (X and Y present).
    const a = FileCache.load(tmpDir);
    const b = FileCache.load(tmpDir);

    // B has a narrower live set and prunes Y — recording Y's hash at prune time.
    b.prune(new Set(['x.ts']));

    // Before B saves, A updates Y with new content and saves first, so Y's
    // on-disk hash no longer matches the hash B recorded when it pruned.
    a.set('y.ts', 'content-y-new', { accurateTokens: 3 });
    a.save();

    // B saves last. Its prune of Y must be discarded because Y changed
    // on disk since B's snapshot — otherwise B would erase A's fresh write.
    b.save();

    const reloaded = FileCache.load(tmpDir);
    expect(reloaded.get('x.ts', 'content-x')).toBeDefined();
    const yEntry = reloaded.get('y.ts', 'content-y-new');
    expect(yEntry).toBeDefined();
    expect(yEntry?.accurateTokens).toBe(3);
  });
});
