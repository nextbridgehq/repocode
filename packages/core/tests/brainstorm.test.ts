import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig } from '../src/config/loader.js';
import { llmCompress } from '../src/compression/llmCompressor.js';
import { discoverFiles } from '../src/discovery/fileDiscovery.js';
import { getCompressionTier } from '../src/types.js';

describe('Brainstorm Edge Cases', () => {
  it('Config file with malformed JSON logs warning and uses defaults', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repocode-test-malformed-'));
    fs.writeFileSync(path.join(dir, 'repocode.config.json'), '{ malformed: json, ]');
    
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    
    const config = await loadConfig(dir, {});
    
    expect(config.root).toBe(dir);
    // Should have logged a warning
    expect(stderrSpy.mock.calls.some(call => call[0].toString().includes('could not load')) || 
           consoleSpy.mock.calls.some(call => call[0].toString().includes('could not load'))).toBe(true);
           
    consoleSpy.mockRestore();
    stderrSpy.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('Single file at exactly maxFileSizeBytes boundary is included', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repocode-test-boundary-'));
    const exactSize = 1000;
    fs.writeFileSync(path.join(dir, 'boundary.txt'), 'x'.repeat(exactSize));
    
    const files = await discoverFiles({
      root: dir,
      include: [],
      exclude: [],
      ignore: { useGitignore: false, useDefaultPatterns: false, customPatterns: [] },
      maxFileSizeBytes: exactSize
    });
    
    expect(files.length).toBe(1);
    expect(files[0].path).toBe('boundary.txt');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('Selective CompressConfig with top10: tier3-llm works', () => {
    const config = { top10: 'tier3-llm' as const, rest: 'none' as const };
    
    expect(getCompressionTier(1, config)).toBe('tier3-llm');
    expect(getCompressionTier(10, config)).toBe('tier3-llm');
    expect(getCompressionTier(11, config)).toBe('none');
  });

  it('LLM provider network error mid-compression triggers retry and fallback', async () => {
    // Mock setTimeout to avoid real waits during retries, but fire immediately
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: () => void,
      ms?: number,
    ) => {
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout);

    let attempts = 0;
    const mockProvider = {
      name: 'test',
      summarize: vi.fn(async () => {
        attempts++;
        throw new Error('Network error');
      }),
      ping: async () => {},
      embed: async () => []
    };

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const originalContent = 'original text';
    const result = await llmCompress(originalContent, 'test.ts', mockProvider as any, undefined, 1000);

    expect(attempts).toBe(3);
    expect(result).toBe(originalContent); // Fallback to original
    expect(stderrSpy).toHaveBeenCalled();

    timeoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
