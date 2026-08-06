import { describe, it, expect } from 'vitest';
import { assemble, formatOutput } from '../../src/output/assembler.js';
import type { BudgetFile } from '../../src/types.js';
import { ZERO_SIGNALS } from '../helpers.js';

function makeFile(p: string): BudgetFile {
  return {
    path: p, absolutePath: `/root/${p}`, size: 100, language: 'typescript',
    mtime: new Date(), isBinary: false, source: 'normal',
    score: 0.5, signalScores: ZERO_SIGNALS,
    content: `// ${p}`, tokens: 10, accurateTokens: 10, compressed: false,
  };
}

describe('assemble', () => {
  it('sets repository name from root path', () => {
    const ctx = assemble([makeFile('src/a.ts')], {
      root: '/home/user/my-project', headerText: '', preamble: true,
      instructionFile: null, budget: null,
    }, 10, 'src/\n└── a.ts');
    expect(ctx.header.repository).toBe('my-project');
  });

  it('includes preamble when enabled', () => {
    const ctx = assemble([makeFile('src/a.ts')], {
      root: '/repo', headerText: '', preamble: true,
      instructionFile: null, budget: null,
    }, 10, '');
    expect(ctx.preamble).toBeTruthy();
    expect(ctx.preamble).toContain('1 file');
  });
});

describe('formatOutput', () => {
  it('delegates to xml formatter', () => {
    const ctx = assemble([makeFile('src/a.ts')], {
      root: '/repo', headerText: '', preamble: false,
      instructionFile: null, budget: 100_000,
    }, 10, '');
    const out = formatOutput(ctx, 'xml');
    expect(out).toContain('<repocode>');
  });

  it('delegates to json formatter', () => {
    const ctx = assemble([makeFile('src/a.ts')], {
      root: '/repo', headerText: '', preamble: false,
      instructionFile: null, budget: null,
    }, 10, '');
    const out = formatOutput(ctx, 'json');
    const parsed = JSON.parse(out);
    expect(parsed.files).toHaveLength(1);
  });
});
