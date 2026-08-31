import { describe, it, expect } from 'vitest';
import { buildExplainReport } from '../src/output/explainReport.js';

const signals = { structural: 0.25, depth: 0.5, size: 0.9876, extension: 1, keyword: 0, recency: 0 };

const file = (over: Record<string, unknown> = {}) => ({
  path: 'src/a.ts', absolutePath: '/r/src/a.ts', size: 1000, language: 'typescript',
  mtime: new Date(), isBinary: false, source: 'normal', score: 0.4321,
  signalScores: signals, content: 'x'.repeat(1000), tokens: 250, accurateTokens: 240,
  compressed: false, compressionLevel: 'none', ...over,
}) as never;

const result = (over: Record<string, unknown> = {}) => ({
  included: [file()], excluded: [{ path: 'src/b.ts', reason: 'below-candidate-cut' }],
  totalTokens: 240, outputTokens: 300, budget: { maxTokens: 50_000, effectiveBudget: 43_000 },
  format: 'json', output: '', parsed: undefined, timingMs: 1, cacheStats: {}, ...over,
}) as never;

const config = { root: '/r', budget: { maxTokens: 50_000 } } as never;

describe('buildExplainReport', () => {
  it('reports rank, score and signals per file', () => {
    const r = buildExplainReport(result(), config);
    expect(r.included[0]).toMatchObject({ path: 'src/a.ts', rank: 1, score: 0.432, tokens: 240 });
    expect(r.included[0].signals.size).toBe(0.988); // rounded, so diffs are not float noise
  });

  it('reports how much of each file actually survived compression', () => {
    // A 10% signature and a whole file both "appear" in a pack; only this distinguishes them.
    const r = buildExplainReport(result({
      included: [file({ content: 'x'.repeat(100), size: 1000, compressed: true, compressionLevel: 'tier2-structural' })],
    }), config);
    expect(r.included[0].retained).toBe(0.1);
    expect(r.included[0].compressionLevel).toBe('tier2-structural');
  });

  it('summarises the compression mix, so a shift toward stubs is visible', () => {
    const r = buildExplainReport(result({
      included: [
        file({ path: 'a.ts', compressionLevel: 'none' }),
        file({ path: 'b.ts', compressionLevel: 'tier2-structural' }),
        file({ path: 'c.ts', compressionLevel: 'tier2-structural' }),
      ],
    }), config);
    expect(r.summary.byCompressionLevel).toEqual({ 'none': 1, 'tier2-structural': 2 });
    expect(r.summary.included).toBe(3);
  });

  it('carries exclusions with their reasons', () => {
    const r = buildExplainReport(result(), config);
    expect(r.excluded).toEqual([{ path: 'src/b.ts', reason: 'below-candidate-cut' }]);
  });

  it('reports the effective budget, not just the requested one', () => {
    // Reserves and overhead come off the top; the requested figure alone explains nothing.
    const r = buildExplainReport(result(), config);
    expect(r.budget).toEqual({ maxTokens: 50_000, effective: 43_000 });
  });

  it('returns null retention rather than dividing by zero on an empty file', () => {
    const r = buildExplainReport(result({ included: [file({ size: 0, content: '' })] }), config);
    expect(r.included[0].retained).toBeNull();
  });
});
