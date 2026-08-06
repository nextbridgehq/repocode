import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { llmCompress } from '../../src/compression/llmCompressor.js';
import { LLMCache } from '../../src/compression/llmCache.js';
import type { LLMProvider } from '../../src/compression/providers/types.js';

const mockProvider: LLMProvider = {
  name: 'mock',
  summarize: vi.fn(async (_content, filePath) =>
    `// LLM summary of ${filePath}\nexport function foo(): void {}`,
  ),
};

describe('llmCompress', () => {
  beforeEach(() => {
    vi.mocked(mockProvider.summarize).mockClear();
  });

  it('returns LLM summary for a file', async () => {
    const result = await llmCompress('function foo() { /* big body */ }', 'src/foo.ts', mockProvider);
    expect(result).toContain('LLM summary of src/foo.ts');
    expect(mockProvider.summarize).toHaveBeenCalledOnce();
  });

  it('uses cache on second call', async () => {
    const content = 'cached content';
    const cache = new LLMCache(os.tmpdir());

    await llmCompress(content, 'src/bar.ts', mockProvider, cache);
    await llmCompress(content, 'src/bar.ts', mockProvider, cache);
    // summarize called only once (second uses cache)
    expect(vi.mocked(mockProvider.summarize).mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('returns original content when inputTokens > budgetTokens (cost guard)', async () => {
    // 104 chars → ceil(104/4) = 26 tokens; budget is 25 → guard triggers
    const bigContent = 'x'.repeat(104);
    const result = await llmCompress(bigContent, 'src/big.ts', mockProvider, undefined, 25);
    expect(result).toBe(bigContent);
    expect(mockProvider.summarize).not.toHaveBeenCalled();
  });
});

describe('LLMCache write behaviour', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repocode-llmcache-'));
    vi.mocked(mockProvider.summarize).mockClear();
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('does not write the cache file once per compression', async () => {
    // Regression: llmCompress used to call cache.save() after every set(), so N
    // compressions rewrote the entire cache file N times — O(n^2) disk I/O on
    // the slowest path in the product.
    const cache = new LLMCache(tmpRoot);
    const writeSpy = vi.spyOn(fs, 'writeFileSync');

    for (let i = 0; i < 10; i++) {
      await llmCompress(`distinct content ${i}`, `src/f${i}.ts`, mockProvider, cache);
    }

    const cacheWrites = writeSpy.mock.calls.filter(c =>
      String(c[0]).includes('llm-cache.json')
    );
    expect(cacheWrites).toHaveLength(0);
  });

  it('persists every entry when the cache is saved once at the end', async () => {
    const cache = new LLMCache(tmpRoot);
    for (let i = 0; i < 5; i++) {
      await llmCompress(`persisted ${i}`, `src/p${i}.ts`, mockProvider, cache);
    }
    cache.save();

    // A fresh cache over the same directory must see all five entries.
    const reloaded = new LLMCache(tmpRoot);
    for (let i = 0; i < 5; i++) {
      expect(reloaded.get(`persisted ${i}`)).toContain(`LLM summary of src/p${i}.ts`);
    }
  });

  it('save() is a no-op when nothing changed', async () => {
    const cache = new LLMCache(tmpRoot);
    await llmCompress('one thing', 'src/one.ts', mockProvider, cache);
    cache.save();

    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    cache.save();
    cache.save();
    const cacheWrites = writeSpy.mock.calls.filter(c =>
      String(c[0]).includes('llm-cache.json')
    );
    expect(cacheWrites).toHaveLength(0);
  });
});

describe('llmCompress retry behaviour', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Replaces setTimeout with a version that records the requested delay and
   * fires the callback immediately, so the test asserts the backoff schedule
   * without actually waiting seconds for it.
   */
  function captureDelays(): number[] {
    const delays: number[] = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: () => void,
      ms?: number,
    ) => {
      delays.push(ms ?? 0);
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout);
    return delays;
  }

  it('makes 3 attempts then falls back to the original content', async () => {
    captureDelays();
    const failing: LLMProvider = {
      name: 'failing',
      summarize: vi.fn(async () => { throw new Error('boom'); }),
    };
    const messages: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((msg: string | Uint8Array) => {
      messages.push(String(msg));
      return true;
    });

    const result = await llmCompress('short content', 'src/x.ts', failing);

    expect(failing.summarize).toHaveBeenCalledTimes(3);
    expect(result).toBe('short content');
    expect(messages.join('')).toContain('after 3 attempts');
  });

  it('doubles the delay between retries, within the jitter band', async () => {
    const delays = captureDelays();
    const failing: LLMProvider = {
      name: 'failing',
      summarize: vi.fn(async () => { throw new Error('boom'); }),
    };
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await llmCompress('short content', 'src/x.ts', failing);

    // Two waits for three attempts; no delay after the final failure.
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBeGreaterThanOrEqual(700);
    expect(delays[0]).toBeLessThanOrEqual(1300);
    expect(delays[1]).toBeGreaterThanOrEqual(1400);
    expect(delays[1]).toBeLessThanOrEqual(2600);
  });

  it('does not retry when the first attempt succeeds', async () => {
    const delays = captureDelays();
    const ok: LLMProvider = {
      name: 'ok',
      summarize: vi.fn(async () => '// summary'),
    };

    const result = await llmCompress('short content', 'src/x.ts', ok);

    expect(ok.summarize).toHaveBeenCalledTimes(1);
    expect(delays).toHaveLength(0);
    expect(result).toBe('// summary');
  });
});
