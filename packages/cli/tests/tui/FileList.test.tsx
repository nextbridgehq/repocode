import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { FileList } from '../../src/tui/components/FileList.js';
import type { TUIFile } from '@repocode/core';

function makeFiles(n: number): TUIFile[] {
  return Array.from({ length: n }, (_, i) => ({
    path: `file${i}.ts`, absolutePath: `/root/file${i}.ts`, size: 100,
    language: null, mtime: new Date(), isBinary: false, source: 'normal' as const,
    score: 1 - i * 0.05,
    signalScores: { structural: 0, depth: 0, size: 0, extension: 0, keyword: 0, recency: 0 },
    content: 'x', tokens: 50,
  }));
}

describe('FileList', () => {
  it('renders only visibleRows files', () => {
    const files = makeFiles(20);
    const { lastFrame } = render(
      <FileList files={files} cursor={0} selected={new Set()} depFiles={new Set()}
        gitStatuses={new Map()} visibleRows={5} cols={120} />
    );
    // Only 5 rows visible; file5.ts and beyond should not appear
    expect(lastFrame()).toContain('file0.ts');
    expect(lastFrame()).toContain('file4.ts');
    expect(lastFrame()).not.toContain('file5.ts');
  });

  it('scrolls window when cursor moves past visible area', () => {
    const files = makeFiles(20);
    const { lastFrame } = render(
      <FileList files={files} cursor={8} selected={new Set()} depFiles={new Set()}
        gitStatuses={new Map()} visibleRows={5} cols={120} />
    );
    expect(lastFrame()).toContain('file8.ts');
    expect(lastFrame()).not.toContain('file0.ts');
  });

  it('shows [x] for selected files', () => {
    const files = makeFiles(3);
    const { lastFrame } = render(
      <FileList files={files} cursor={0} selected={new Set(['file1.ts'])} depFiles={new Set()}
        gitStatuses={new Map()} visibleRows={5} cols={120} />
    );
    expect(lastFrame()).toContain('[x]');
  });

  it('shows → for dep files', () => {
    const files = makeFiles(3);
    const { lastFrame } = render(
      <FileList files={files} cursor={0} selected={new Set()} depFiles={new Set(['file1.ts'])}
        gitStatuses={new Map()} visibleRows={5} cols={120} />
    );
    expect(lastFrame()).toContain('→');
  });
});
