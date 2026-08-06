import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { estimateFast } from '../../src/tokens/fastEstimator.js';
import { estimateAccurateBatch } from '../../src/tokens/accurateEstimator.js';
import { FileCache } from '../../src/cache/fileCache.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('estimateFast', () => {
  it('returns chars/4 rounded', () => {
    expect(estimateFast('hello world')).toBe(Math.ceil('hello world'.length / 4));
  });
  it('returns 0 for empty string', () => expect(estimateFast('')).toBe(0));
});

describe('estimateAccurateBatch', () => {
  it('returns a count for each file', async () => {
    const fixture = path.join(__dirname, '../fixtures/simple-ts/src/auth/login.ts');
    const result = await estimateAccurateBatch([fixture]);
    expect(result.has(fixture)).toBe(true);
    expect(result.get(fixture)!).toBeGreaterThan(0);
  });
});

describe('estimateAccurateBatch with cache', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-est-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('populates the cache on first call and reuses it on second call', async () => {
    const filePath = path.join(tmpDir, 'a.ts');
    fs.writeFileSync(filePath, 'const a = 1;');
    const cache = FileCache.load(tmpDir);

    const first = await estimateAccurateBatch([filePath], cache, tmpDir);
    const cachedEntry = cache.get('a.ts', 'const a = 1;');
    expect(cachedEntry?.accurateTokens).toBe(first.get(filePath));

    const second = await estimateAccurateBatch([filePath], cache, tmpDir);
    expect(second.get(filePath)).toBe(first.get(filePath));
  });

  it('recomputes and updates the cache when file content changes', async () => {
    const filePath = path.join(tmpDir, 'a.ts');
    fs.writeFileSync(filePath, 'const a = 1;');
    const cache = FileCache.load(tmpDir);
    await estimateAccurateBatch([filePath], cache, tmpDir);

    fs.writeFileSync(filePath, 'const a = 1; const b = 2; const c = 3;');
    const result = await estimateAccurateBatch([filePath], cache, tmpDir);
    const newEntry = cache.get('a.ts', 'const a = 1; const b = 2; const c = 3;');
    expect(newEntry?.accurateTokens).toBe(result.get(filePath));
  });

  it('omitting cache/root preserves uncached behavior', async () => {
    const filePath = path.join(tmpDir, 'a.ts');
    fs.writeFileSync(filePath, 'const a = 1;');
    const result = await estimateAccurateBatch([filePath]);
    expect(result.get(filePath)).toBeGreaterThan(0);
  });
});

describe('estimateAccurateBatch — avoids redundant disk reads', () => {
  it('reads a cache-miss file at most once from disk', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-readcount-'));
    const fp = path.join(tmpDir, 'once.ts');
    fs.writeFileSync(fp, 'export const once = 1;\n', 'utf-8');
    const cache = FileCache.load(tmpDir);

    const readSpy = vi.spyOn(fs, 'readFileSync');
    readSpy.mockClear();

    await estimateAccurateBatch([fp], cache, tmpDir);

    const readsOfThisFile = readSpy.mock.calls.filter(call => call[0] === fp).length;
    expect(readsOfThisFile).toBe(1);

    readSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('estimateAccurateBatch — tiktoken fallback', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('tiktoken');
  });

  it('falls back to estimateFast and warns once when tiktoken fails to load', async () => {
    vi.resetModules();
    vi.doMock('tiktoken', () => ({
      get_encoding: () => { throw new Error('WASM load failed'); },
    }));
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const { estimateAccurateBatch: importedEstimate } = await import('../../src/tokens/accurateEstimator.js');
    const thisFile = fileURLToPath(import.meta.url);
    const result = await importedEstimate([thisFile]);

    // Should return a positive count from the fast estimator, not crash
    expect(result.get(thisFile)).toBeGreaterThan(0);

    // Warning emitted exactly once
    const warnCalls = stderrSpy.mock.calls.filter(c =>
      String(c[0]).includes('tiktoken failed to load')
    );
    expect(warnCalls).toHaveLength(1);

    // Second call should NOT emit the warning again
    await importedEstimate([thisFile]);
    const warnCalls2 = stderrSpy.mock.calls.filter(c =>
      String(c[0]).includes('tiktoken failed to load')
    );
    expect(warnCalls2).toHaveLength(1); // still 1, not 2

    stderrSpy.mockRestore();
  });

  it('falls back to estimateFast when the tiktoken module itself fails to load', async () => {
    // Distinct from the case above: there, get_encoding() throws but the module
    // resolves. Here the module never loads at all (missing WASM binary,
    // unsupported platform, restricted runtime). With a static top-level import
    // this rejected the whole module graph before any try/catch could run.
    vi.resetModules();
    vi.doMock('tiktoken', () => { throw new Error('Cannot find module tiktoken'); });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const { estimateAccurateBatch: importedEstimate } = await import('../../src/tokens/accurateEstimator.js');
    const thisFile = fileURLToPath(import.meta.url);
    const result = await importedEstimate([thisFile]);

    expect(result.get(thisFile)).toBeGreaterThan(0);

    const warnCalls = stderrSpy.mock.calls.filter(c =>
      String(c[0]).includes('tiktoken failed to load')
    );
    expect(warnCalls).toHaveLength(1);

    stderrSpy.mockRestore();
  });
});
