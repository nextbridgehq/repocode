import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { App } from '../../src/tui/App.js';
import type { TUIPipelineResult, TUIFile } from '@repocode/core';

function makeFile(filePath: string, score = 0.5): TUIFile {
  return {
    path: filePath, absolutePath: `/root/${filePath}`, size: 100,
    language: null, mtime: new Date(), isBinary: false, source: 'normal',
    score, signalScores: { structural: 0, depth: 0, size: 0, extension: 0, keyword: 0, recency: 0 },
    content: 'content', tokens: 50,
  };
}

function makeTUIResult(files: TUIFile[]): TUIPipelineResult {
  return { files, imports: new Map() };
}

describe('App', () => {
  it('renders StatusBar and Footer', () => {
    const onPack = vi.fn();
    const onQuit = vi.fn();
    const { lastFrame } = render(
      <App
        tuiResult={makeTUIResult([makeFile('a.ts'), makeFile('b.ts')])}
        budget={32000}
        root="/root"
        gitStatuses={new Map()}
        onPack={onPack}
        onQuit={onQuit}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('selected');   // StatusBar
    expect(frame).toContain('space');      // Footer browse hints
  });

  it('space toggles file selection', () => {
    const onPack = vi.fn();
    const { stdin, lastFrame } = render(
      <App
        tuiResult={makeTUIResult([makeFile('a.ts', 0.9), makeFile('b.ts', 0.7)])}
        budget={32000}
        root="/root"
        gitStatuses={new Map()}
        onPack={onPack}
        onQuit={vi.fn()}
      />
    );
    // Initially nothing selected — press space to toggle cursor file
    stdin.write(' ');
    expect(lastFrame()).toContain('[x]');
  });

  it('n deselects all', () => {
    const onPack = vi.fn();
    const { stdin, lastFrame } = render(
      <App
        tuiResult={makeTUIResult([makeFile('a.ts')])}
        budget={32000}
        root="/root"
        initialSelected={new Set(['a.ts'])}
        gitStatuses={new Map()}
        onPack={onPack}
        onQuit={vi.fn()}
      />
    );
    stdin.write('n');
    // After n, nothing should be selected
    expect(lastFrame()).not.toContain('[x]');
  });

  it('Enter calls onPack with current selection', () => {
    const onPack = vi.fn();
    const { stdin } = render(
      <App
        tuiResult={makeTUIResult([makeFile('a.ts')])}
        budget={32000}
        root="/root"
        initialSelected={new Set(['a.ts'])}
        gitStatuses={new Map()}
        onPack={onPack}
        onQuit={vi.fn()}
      />
    );
    stdin.write('\r');
    expect(onPack).toHaveBeenCalledWith(expect.any(Set));
  });

  it('/ enters search mode and shows SearchBar', () => {
    const { stdin, lastFrame } = render(
      <App
        tuiResult={makeTUIResult([makeFile('a.ts')])}
        budget={32000}
        root="/root"
        gitStatuses={new Map()}
        onPack={vi.fn()}
        onQuit={vi.fn()}
      />
    );
    stdin.write('/');
    expect(lastFrame()).toContain('/ ');  // SearchBar prefix
  });
});
