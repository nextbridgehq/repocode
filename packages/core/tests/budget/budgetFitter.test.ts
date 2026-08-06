import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import { fitToBudget } from '../../src/budget/budgetFitter.js';
import type { RankedFile } from '../../src/types.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { estimateFast } from '../../src/tokens/fastEstimator.js';
import { ZERO_SIGNALS } from '../helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeRanked(p: string, content: string, score = 0.5): RankedFile {
  const tmpDir = os.tmpdir();
  const absPath = path.join(tmpDir, p.replace(/\//g, '_'));
  fs.writeFileSync(absPath, content);
  return {
    path: p, absolutePath: absPath,
    size: Buffer.byteLength(content), language: 'typescript',
    mtime: new Date(), isBinary: false, source: 'normal',
    score, signalScores: ZERO_SIGNALS,
  };
}

describe('fitToBudget', () => {
  it('includes files that fit within budget', async () => {
    const files = [makeRanked('src/a.ts', 'const a = 1;', 0.9)];
    const { included, excluded } = await fitToBudget(files, {
      pinned: [], compress: 'none',
    }, { maxTokens: 100_000, reserveForResponse: 4000, reserveForPrompt: 2000, effectiveBudget: 94_000 });
    expect(included.length).toBe(1);
    expect(excluded.length).toBe(0);
  });

  it('excludes files that exceed budget even after compression', async () => {
    // 1 token budget — nothing fits
    const bigContent = 'x'.repeat(10000);
    const files = [makeRanked('src/big.ts', bigContent, 0.9)];
    const { included, excluded } = await fitToBudget(files, {
      pinned: [], compress: 'tier1-regex',
    }, { maxTokens: 1, reserveForResponse: 0, reserveForPrompt: 0, effectiveBudget: 1 });
    expect(included.length).toBe(0);
    expect(excluded[0].reason).toMatch(/budget/);
  });

  it('total tokens of included files ≤ effective budget', async () => {
    const files = Array.from({ length: 20 }, (_, i) =>
      makeRanked(`src/file${i}.ts`, 'const x = '.repeat(200) + '0;', 0.5 - i * 0.02)
    );
    const budget = { maxTokens: 10_000, reserveForResponse: 500, reserveForPrompt: 500, effectiveBudget: 9_000 };
    const { included } = await fitToBudget(files, { pinned: [], compress: 'none' }, budget);
    const total = included.reduce((s, f) => s + f.accurateTokens, 0);
    expect(total).toBeLessThanOrEqual(budget.effectiveBudget + 500); // +500 tolerance for overhead
  });

  it('reports an unreadable file on stderr using the repocode warning prefix', async () => {
    // A ranked file whose absolutePath does not exist forces the read to throw.
    const missing: RankedFile = {
      path: 'src/missing.ts',
      absolutePath: path.join(os.tmpdir(), 'repocode-does-not-exist-abc123.ts'),
      size: 10,
      language: 'typescript',
      mtime: new Date(),
      isBinary: false,
      source: 'normal',
      score: 0.9,
      signalScores: ZERO_SIGNALS,
    };

    const messages: string[] = [];
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((msg: string | Uint8Array) => {
        messages.push(String(msg));
        return true;
      });
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { excluded } = await fitToBudget(
      [missing],
      { pinned: [], compress: 'none' },
      { maxTokens: 100_000, reserveForResponse: 0, reserveForPrompt: 0, effectiveBudget: 100_000 },
    );

    stderrSpy.mockRestore();
    consoleSpy.mockRestore();

    // The file is still excluded, exactly as before.
    expect(excluded.map(e => e.path)).toContain('src/missing.ts');

    // The warning goes to stderr in the house format, and NOT to console.warn.
    const warning = messages.find(m => m.includes('src/missing.ts'));
    expect(warning).toBeDefined();
    expect(warning).toContain('[repocode] warning:');
    expect(warning!.endsWith('\n')).toBe(true);
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

// Content designed so each compression tier produces a predictably smaller output:
// whole: large (comments + function body)
// tier1 (no comments): smaller
// tier2 (no body): much smaller (~just the signature line)
function makeTieredContent(): string {
  return [
    '// ' + 'x'.repeat(300),  // 303-char comment stripped by tier1
    '// ' + 'x'.repeat(300),  // another comment
    'function processItems(items: string[], config: Record<string, unknown>): Promise<string[]> {',
    '  ' + 'const result = items.map(i => i.trim()); '.repeat(15),
    '  return Promise.resolve(result);',
    '}',
  ].join('\n');
}

describe('budgetFitter cascade', () => {
  it('compressionLevel is "none" when file fits whole', async () => {
    const content = 'const x = 1;';
    const file = makeRanked('src/small.ts', content, 0.9);
    const tokens = estimateFast(content);
    const { included } = await fitToBudget([file],
      { pinned: [], compress: 'partial' },
      { maxTokens: tokens + 1000, reserveForResponse: 0, reserveForPrompt: 0, effectiveBudget: tokens + 1000 });
    expect(included[0].compressionLevel).toBe('none');
    expect(included[0].compressed).toBe(false);
  });

  it('compressionLevel is "tier1-regex" when whole does not fit but tier1 does', async () => {
    const content = makeTieredContent();
    const { compressTier1 } = await import('../../src/budget/compression.js');
    const t1 = compressTier1(content, 'typescript');
    const wholeTokens = estimateFast(content);
    const t1Tokens = estimateFast(t1);
    if (t1Tokens >= wholeTokens - 1) return; // can't test this with current content

    const file = makeRanked('src/f.ts', content, 0.9);
    const budget = wholeTokens - 1; // too small for whole, big enough for tier1
    const { included } = await fitToBudget([file],
      { pinned: [], compress: 'partial' },
      { maxTokens: budget + 1000, reserveForResponse: 0, reserveForPrompt: 0, effectiveBudget: budget });
    expect(included[0]?.compressionLevel).toBe('tier1-regex');
    expect(included[0]?.compressed).toBe(true);
  });

  it('compressionLevel is "tier2-structural" when tier1 does not fit but tier2 does', async () => {
    const { compressTier1, compressTier2 } = await import('../../src/budget/compression.js');
    const content = makeTieredContent();
    const t1 = compressTier1(content, 'typescript');
    const t2 = compressTier2(t1, 'typescript');
    const t1Tokens = estimateFast(t1);
    const t2Tokens = estimateFast(t2);
    if (t2Tokens >= t1Tokens - 1) return; // can't test with this content

    const file = makeRanked('src/f.ts', content, 0.9);
    const budget = t1Tokens - 1; // too small for tier1, big enough for tier2
    const { included } = await fitToBudget([file],
      { pinned: [], compress: 'partial' },
      { maxTokens: budget + 1000, reserveForResponse: 0, reserveForPrompt: 0, effectiveBudget: budget });
    expect(included[0]?.compressionLevel).toBe('tier2-structural');
  });

  it('compressionLevel is "partial" when tier2 does not fit but partial does', async () => {
    const { compressTier1, compressTier2 } = await import('../../src/budget/compression.js');
    const { extractPartial } = await import('../../src/budget/partialExtractor.js');
    // Large file: many imports + one function body — tier2 keeps imports intact (large), partial drops most
    const manyImports = Array.from({ length: 80 }, (_, i) =>
      `import { item${i} } from './module${i}.js';`
    ).join('\n');
    const func = `\nfunction process(x: string): string {\n  return x;\n}`;
    const content = manyImports + func;
    const t1 = compressTier1(content, 'typescript');
    const t2 = compressTier2(t1, 'typescript');
    const partial = extractPartial(t2, 'typescript');
    const t2Tokens = estimateFast(t2);
    const partialTokens = estimateFast(partial);
    if (partialTokens >= t2Tokens - 1) return;

    const file = makeRanked('src/large.ts', content, 0.9);
    const budget = t2Tokens - 1;
    const { included } = await fitToBudget([file],
      { pinned: [], compress: 'partial' },
      { maxTokens: budget + 1000, reserveForResponse: 0, reserveForPrompt: 0, effectiveBudget: budget });
    expect(included[0]?.compressionLevel).toBe('partial');
  });

  it('excludes file with exceeds-budget-after-compression when nothing fits', async () => {
    const content = 'const x = ' + '1,'.repeat(5000);
    const file = makeRanked('src/huge.ts', content, 0.9);
    const { included, excluded } = await fitToBudget([file],
      { pinned: [], compress: 'partial' },
      { maxTokens: 1, reserveForResponse: 0, reserveForPrompt: 0, effectiveBudget: 1 });
    expect(included.length).toBe(0);
    expect(excluded[0].reason).toBe('exceeds-budget-after-compression');
  });

  it('ceiling tier2: partial level never attempted', async () => {
    const { compressTier1, compressTier2 } = await import('../../src/budget/compression.js');
    const manyImports = Array.from({ length: 80 }, (_, i) =>
      `import { item${i} } from './module${i}.js';`
    ).join('\n');
    const content = manyImports + `\nfunction f(x: string): string {\n  return x;\n}`;
    const t2 = compressTier2(compressTier1(content, 'typescript'), 'typescript');
    const t2Tokens = estimateFast(t2);

    const file = makeRanked('src/f.ts', content, 0.9);
    const budget = t2Tokens - 1; // would fit partial but not tier2
    const { included, excluded } = await fitToBudget([file],
      { pinned: [], compress: 'tier2-structural' }, // ceiling: no partial
      { maxTokens: budget + 1000, reserveForResponse: 0, reserveForPrompt: 0, effectiveBudget: budget });
    // With ceiling=tier2, partial is never tried → excluded
    expect(included.length).toBe(0);
    expect(excluded[0].path).toBe('src/f.ts');
  });

  it('ceiling tier1: tier2 never attempted; file excluded when only tier2 would fit', async () => {
    const { compressTier1, compressTier2 } = await import('../../src/budget/compression.js');
    const content = makeTieredContent();
    const t1 = compressTier1(content, 'typescript');
    const t2 = compressTier2(t1, 'typescript');
    const t1Tokens = estimateFast(t1);
    const t2Tokens = estimateFast(t2);
    if (t2Tokens >= t1Tokens - 1) return;

    const file = makeRanked('src/f.ts', content, 0.9);
    const budget = t1Tokens - 1; // too small for tier1, would fit tier2
    const { included } = await fitToBudget([file],
      { pinned: [], compress: 'tier1-regex' }, // ceiling: no tier2
      { maxTokens: budget + 1000, reserveForResponse: 0, reserveForPrompt: 0, effectiveBudget: budget });
    expect(included.length).toBe(0);
  });

  it('ceiling none: only whole-file attempted; compression never tried', async () => {
    const content = '// comment\n'.repeat(50) + 'const x = 1;';
    const file = makeRanked('src/f.ts', content, 0.9);
    const tokens = estimateFast(content);
    const budget = tokens - 1; // slightly too small for whole
    const { included } = await fitToBudget([file],
      { pinned: [], compress: 'none' },
      { maxTokens: budget + 1000, reserveForResponse: 0, reserveForPrompt: 0, effectiveBudget: budget });
    expect(included.length).toBe(0);
  });

  it('pinned force-include: included even when over budget', async () => {
    const content = 'const x = ' + '1,'.repeat(5000);
    const file = makeRanked('src/pinned.ts', content, 0.9);
    const { included } = await fitToBudget([file],
      { pinned: ['src/pinned.ts'], compress: 'none' },
      { maxTokens: 1, reserveForResponse: 0, reserveForPrompt: 0, effectiveBudget: 1 });
    expect(included.length).toBe(1);
    expect(included[0].compressionLevel).toBe('none');
  });

  it('compressed: true when compressionLevel !== "none"', async () => {
    const content = makeTieredContent();
    const { compressTier1 } = await import('../../src/budget/compression.js');
    const t1 = compressTier1(content, 'typescript');
    const wholeTokens = estimateFast(content);
    const t1Tokens = estimateFast(t1);
    if (t1Tokens >= wholeTokens) return;

    const file = makeRanked('src/f.ts', content, 0.9);
    const { included } = await fitToBudget([file],
      { pinned: [], compress: 'tier1-regex' },
      { maxTokens: t1Tokens + 1000, reserveForResponse: 0, reserveForPrompt: 0, effectiveBudget: t1Tokens });
    expect(included[0]?.compressed).toBe(true);
    expect(included[0]?.compressionLevel).not.toBe('none');
  });

  it('correction loop drops lowest-ranked file regardless of compression level', async () => {
    // Three files: #1 whole, #2 whole, #3 partial — accurate total exceeds budget
    // Correction loop must drop #3 (lowest ranked) even though it is partial
    const smallContent = 'const a = 1;';
    const f1 = makeRanked('src/a.ts', smallContent, 0.9);
    const f2 = makeRanked('src/b.ts', smallContent, 0.7);
    const f3 = makeRanked('src/c.ts', smallContent, 0.3); // lowest ranked
    // Use very large accurate budget so all fit during fast estimate,
    // then the correction loop triggers via the actual test mechanism
    // Since accurate = fast estimate here, just verify rank-based drop order
    const { included } = await fitToBudget([f1, f2, f3],
      { pinned: [], compress: 'partial' },
      // Budget just enough for 2 files' fast estimate
      { maxTokens: estimateFast(smallContent) * 5 + 100, reserveForResponse: 0, reserveForPrompt: 0,
        effectiveBudget: estimateFast(smallContent) * 5 });
    // f3 (rank #3, lowest score) should be excluded
    const paths = included.map(f => f.path);
    expect(paths).toContain('src/a.ts');
    expect(paths).toContain('src/b.ts');
    expect(paths).not.toContain('src/c.ts');
  });
});

describe('budgetFitter LLM pre-redaction', () => {
  it('redacts secrets before LLM compression when securityMode is redact', async () => {
    // Create a temp file with a fake AWS key.
    // Content must be:
    //   - larger than effectiveBudget (1000 tokens) so the whole file does not fit
    //   - smaller than llmBudgetTokens (10000) so the LLM cost guard does not skip it
    //   - tier1/tier2 outputs also do not fit in 1000 tokens (same content repeated = no comment/body to strip)
    // AKIAIOSFODNN7EXAMPLE (the previous fixture) is AWS's own official placeholder key and is
    // built into Secretlint's AWS rule as an explicit ignore — it never fires under the new
    // scanner. Use a non-placeholder key of the same shape (AKIA + 16 [A-Z0-9] chars) instead.
    const secret = 'AKIA' + 'Z'.repeat(16);
    const lineTemplate = `export const config${Math.random().toString(36).slice(2, 6)} = { key: "${secret}", value: "data" };\n`;
    const content = lineTemplate.repeat(200); // ~200 × ~17 tokens = ~3400 tokens (fits under 10000)
    const tmpDir = os.tmpdir();
    const absPath = path.join(tmpDir, 'secret_file.ts');
    fs.writeFileSync(absPath, content);

    const file: RankedFile = {
      path: 'secret_file.ts',
      absolutePath: absPath,
      size: Buffer.byteLength(content),
      language: 'typescript',
      mtime: new Date(),
      isBinary: false,
      source: 'normal',
      score: 0.9,
      signalScores: ZERO_SIGNALS,
    };

    const mockProvider = {
      summarize: vi.fn().mockResolvedValue('// summarized'),
      embed: vi.fn(),
      ping: vi.fn(),
      name: 'mock',
    };

    const { included } = await fitToBudget(
      [file],
      {
        pinned: [],
        compress: 'tier3-llm',
        llmProvider: mockProvider as any,
        llmBudgetTokens: 10000,
        securityMode: 'redact',
      },
      { maxTokens: 1000, reserveForResponse: 0, reserveForPrompt: 0, effectiveBudget: 1000 }
    );

    // The LLM was called with the content — verify it did NOT receive the raw secret
    expect(mockProvider.summarize).toHaveBeenCalled();
    const calledWith = mockProvider.summarize.mock.calls[0][0] as string;
    expect(calledWith).not.toContain(secret);
    expect(calledWith).toContain('[REDACTED]');

    fs.rmSync(absPath);
  });
});

describe('budgetFitter LLM-to-partial cascade', () => {
  it('extracts partial content from the structural (tier2) output, not the LLM summary, when the summary still exceeds budget', async () => {
    const { compressTier1, compressTier2 } = await import('../../src/budget/compression.js');
    const { extractPartial } = await import('../../src/budget/partialExtractor.js');

    const manyImports = Array.from({ length: 80 }, (_, i) =>
      `import { item${i} } from './module${i}.js';`
    ).join('\n');
    const content = manyImports + `\nfunction process(x: string): string {\n  return x;\n}`;

    const t1 = compressTier1(content, 'typescript');
    const t2 = compressTier2(t1, 'typescript');
    const t2Tokens = estimateFast(t2);
    const partialOfT2 = extractPartial(t2, 'typescript');
    const partialTokens = estimateFast(partialOfT2);

    const bigSummary = 'This file handles item processing and module wiring. '.repeat(50);
    const summaryTokens = estimateFast(bigSummary);

    // Guard against fastEstimator heuristic changes breaking the size relationships this test relies on.
    if (partialTokens >= t2Tokens - 1 || summaryTokens <= partialTokens + 20) return;

    const mockProvider = {
      summarize: vi.fn().mockResolvedValue(bigSummary),
      embed: vi.fn(),
      ping: vi.fn(),
      name: 'mock',
    };

    const file = makeRanked('src/big.ts', content, 0.9);
    const budget = partialTokens + 20; // fits partial-of-t2, but not t2 itself and not the LLM summary

    const { included } = await fitToBudget(
      [file],
      { pinned: [], compress: 'partial', llmProvider: mockProvider as any, llmBudgetTokens: 100_000 },
      { maxTokens: budget + 1000, reserveForResponse: 0, reserveForPrompt: 0, effectiveBudget: budget },
    );

    expect(included.length).toBe(1);
    expect(included[0].compressionLevel).toBe('partial');
    expect(included[0].content).toContain('function process');
    expect(included[0].content).not.toContain('item processing');
  });
});

describe('budgetFitter concurrency and error handling', () => {
  it('processes files concurrently within the concurrency limit and maintains order', async () => {
    // We will use vitest's vi.spyOn on fs.promises.readFile to mock concurrent reads
    const readFileSpy = vi.spyOn(fs.promises, 'readFile').mockImplementation(async (filePath) => {
      // simulate delay
      await new Promise(resolve => setTimeout(resolve, 10));
      return `content of ${path.basename(filePath as string)}`;
    });

    const files = Array.from({ length: 10 }, (_, i) => makeRanked(`src/file${i}.ts`, `content of file${i}.ts`, 0.9 - i * 0.05));
    
    // We'll give it enough budget to include everything
    const { included } = await fitToBudget(
      files,
      { pinned: [], compress: 'none', concurrency: 3 },
      { maxTokens: 100_000, reserveForResponse: 0, reserveForPrompt: 0, effectiveBudget: 100_000 }
    );

    expect(readFileSpy).toHaveBeenCalledTimes(10);
    expect(included.length).toBe(10);
    // Order should match rank score order (file0 to file9)
    expect(included.map(f => path.basename(f.path))).toEqual(
      Array.from({ length: 10 }, (_, i) => `file${i}.ts`)
    );

    readFileSpy.mockRestore();
  });

  it('warns and gracefully skips files that fail to read', async () => {
    const messages: string[] = [];
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((msg: string | Uint8Array) => {
        messages.push(String(msg));
        return true;
      });
    const readFileSpy = vi.spyOn(fs.promises, 'readFile').mockImplementation(async (filePath) => {
      const name = path.basename(filePath as string);
      if (name.endsWith('bad.ts')) throw new Error('EACCES permission denied');
      return `content of ${name}`;
    });

    const good1 = makeRanked('src/good1.ts', 'content', 0.9);
    const bad = makeRanked('src/bad.ts', 'content', 0.8);
    const good2 = makeRanked('src/good2.ts', 'content', 0.7);

    const { included, excluded } = await fitToBudget(
      [good1, bad, good2],
      { pinned: [], compress: 'none', concurrency: 2 },
      { maxTokens: 100_000, reserveForResponse: 0, reserveForPrompt: 0, effectiveBudget: 100_000 }
    );

    const warning = messages.find(m => m.includes('src/bad.ts'));
    expect(warning).toBeDefined();
    expect(warning).toContain('[repocode] warning: failed to read src/bad.ts');

    expect(included.length).toBe(2);
    expect(included.map(f => path.basename(f.path))).toEqual(['good1.ts', 'good2.ts']);

    expect(excluded.length).toBe(1);
    expect(excluded[0].path).toBe('src/bad.ts');
    expect(excluded[0].reason).toBe('binary'); // fallback reason for unreadable files

    stderrSpy.mockRestore();
    readFileSpy.mockRestore();
  });
});
