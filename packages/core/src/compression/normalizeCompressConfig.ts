import type { CompressConfig, SelectiveCompressConfig } from '../types.js';

export function normalizeCompressConfig(config: CompressConfig): SelectiveCompressConfig {
  if (typeof config === 'string') {
    return { top10: 'none', top50: 'none', rest: config };
  }
  return {
    top10: config.top10 ?? 'none',
    top50: config.top50 ?? 'none',
    rest: config.rest ?? 'partial',
  };
}
