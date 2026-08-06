import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { FileRow } from '../../src/tui/components/FileRow.js';
import { StatusBar } from '../../src/tui/components/StatusBar.js';
import { SearchBar } from '../../src/tui/components/SearchBar.js';
import { Footer } from '../../src/tui/components/Footer.js';
import type { TUIFile } from '@repocode/core';

function makeFile(filePath: string): TUIFile {
  return {
    path: filePath, absolutePath: `/root/${filePath}`, size: 400,
    language: null, mtime: new Date(), isBinary: false, source: 'normal',
    score: 0.87, signalScores: { structural: 0, depth: 0, size: 0, extension: 0, keyword: 0, recency: 0 },
    content: 'x'.repeat(400), tokens: 100,
  };
}

describe('FileRow', () => {
  it('shows [x] when selected', () => {
    const { lastFrame } = render(
      <FileRow file={makeFile('src/a.ts')} isSelected={true} isCursor={false} isDep={false} cols={120} />
    );
    expect(lastFrame()).toContain('[x]');
  });

  it('shows [ ] when not selected', () => {
    const { lastFrame } = render(
      <FileRow file={makeFile('src/a.ts')} isSelected={false} isCursor={false} isDep={false} cols={120} />
    );
    expect(lastFrame()).toContain('[ ]');
  });

  it('shows → marker when isDep', () => {
    const { lastFrame } = render(
      <FileRow file={makeFile('src/a.ts')} isSelected={false} isCursor={false} isDep={true} cols={120} />
    );
    expect(lastFrame()).toContain('→');
  });

  it('shows git badge when gitStatus provided', () => {
    const { lastFrame } = render(
      <FileRow file={makeFile('src/a.ts')} isSelected={false} isCursor={false} isDep={false} gitStatus="M" cols={120} />
    );
    expect(lastFrame()).toContain('[M]');
  });

  it('omits score bar below MIN_WIDTH_SCORE_BAR', () => {
    const { lastFrame } = render(
      <FileRow file={makeFile('src/a.ts')} isSelected={false} isCursor={false} isDep={false} cols={80} />
    );
    // Score bar uses block chars — should not appear at 80 cols
    expect(lastFrame()).not.toMatch(/█/);
  });
});

describe('StatusBar', () => {
  it('shows selected/total counts', () => {
    const { lastFrame } = render(
      <StatusBar selectedCount={3} totalCount={47} selectedTokens={5000} maxTokens={32000} profileName={null} sortBy="rank" />
    );
    expect(lastFrame()).toContain('3/47');
  });

  it('shows "no budget" when maxTokens is null', () => {
    const { lastFrame } = render(
      <StatusBar selectedCount={0} totalCount={10} selectedTokens={0} maxTokens={null} profileName={null} sortBy="rank" />
    );
    expect(lastFrame()).toContain('no budget');
  });

  it('shows profile name when provided', () => {
    const { lastFrame } = render(
      <StatusBar selectedCount={2} totalCount={10} selectedTokens={1000} maxTokens={32000} profileName="auth" sortBy="rank" />
    );
    expect(lastFrame()).toContain('auth');
  });
});

describe('SearchBar', () => {
  it('shows the current filter string', () => {
    const { lastFrame } = render(<SearchBar filter="auth" />);
    expect(lastFrame()).toContain('auth');
  });
});

describe('Footer', () => {
  it('shows browse hints in browse mode', () => {
    const { lastFrame } = render(<Footer mode="browse" />);
    expect(lastFrame()).toContain('space');
    expect(lastFrame()).toContain('enter');
  });

  it('shows search hints in search mode', () => {
    const { lastFrame } = render(<Footer mode="search" />);
    expect(lastFrame()).toContain('esc');
  });

  it('shows editor hint when editorHint is true', () => {
    const { lastFrame } = render(<Footer mode="browse" editorHint={true} />);
    expect(lastFrame()).toContain('$EDITOR');
  });
});
