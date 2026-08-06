import { describe, it, expect } from 'vitest';
import { normalizeCompressConfig } from '../../src/compression/normalizeCompressConfig.js';

describe('normalizeCompressConfig', () => {
  it('converts a bare string to SelectiveCompressConfig', () => {
    const result = normalizeCompressConfig('tier2-structural');
    expect(result).toEqual({ top10: 'none', top50: 'none', rest: 'tier2-structural' });
  });

  it('fills in missing keys with defaults when given a partial object', () => {
    const result = normalizeCompressConfig({ rest: 'tier3-llm' });
    expect(result.top10).toBe('none');
    expect(result.top50).toBe('none');
    expect(result.rest).toBe('tier3-llm');
  });

  it('passes through a fully specified SelectiveCompressConfig unchanged', () => {
    const input = { top10: 'none', top50: 'tier1-regex', rest: 'tier2-structural' } as const;
    expect(normalizeCompressConfig(input)).toEqual(input);
  });

  it("uses 'partial' as the default for rest when object has no rest key", () => {
    const result = normalizeCompressConfig({});
    expect(result.rest).toBe('partial');
  });
});
