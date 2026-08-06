import { describe, it, expect } from 'vitest';
import { formatJson } from '../../src/output/formatters/json.js';
import type { AssembledContext } from '../../src/output/assembler.js';
import { ZERO_SIGNALS } from '../helpers.js';

function makeCtx(includeScores = false): AssembledContext {
  return {
    preamble: '',
    header: { generated: '2026-01-01T00:00:00.000Z', repository: 'test', tokens: 100, budget: null, fileCount: 1 },
    instructions: '',
    tree: '',
    includeScores,
    files: [{
      path: 'src/foo.ts',
      language: 'typescript',
      tokens: 100,
      rank: 1,
      content: 'const x = 1;',
      compressed: false,
      score: 0.87,
      signals: ZERO_SIGNALS,
    }],
  };
}

describe('formatJson metadata.version', () => {
  it('reflects the actual @repocode/core package version, not a hardcoded string', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'));
    const json = JSON.parse(formatJson(makeCtx(false)));
    expect(json.metadata.version).toBe(pkg.version);
  });
});

describe('formatJson with includeScores', () => {
  it('omits score and signals by default', () => {
    const json = JSON.parse(formatJson(makeCtx(false)));
    expect(json.files[0]).not.toHaveProperty('score');
    expect(json.files[0]).not.toHaveProperty('signals');
  });

  it('includes score and signals when includeScores is true', () => {
    const json = JSON.parse(formatJson(makeCtx(true)));
    expect(json.files[0].score).toBe(0.87);
    expect(json.files[0].signals).toBeDefined();
  });
});
