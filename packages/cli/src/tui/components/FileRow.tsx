import React from 'react';
import { Text, Box } from 'ink';
import type { TUIFile } from '@repocode/core';
import { scoreBar, Colors, MIN_WIDTH_SCORE_BAR, MIN_WIDTH_TOKENS } from '../constants.js';

interface FileRowProps {
  file: TUIFile;
  isSelected: boolean;
  isCursor: boolean;
  isDep: boolean;
  gitStatus?: 'M' | 'A' | 'D' | '?';
  cols: number;
}

export function FileRow({ file, isSelected, isCursor, isDep, gitStatus, cols }: FileRowProps) {
  const checkbox = isSelected ? '[x]' : '[ ]';
  const depMarker = isDep ? '→ ' : '  ';
  const badge = gitStatus ? ` [${gitStatus}]` : '';
  const bar = scoreBar(file.score, cols);
  const tokStr = cols >= MIN_WIDTH_TOKENS ? ` ${String(file.tokens).padStart(5)} tk` : '';
  const scoreStr = bar ? `  ${bar} ${file.score.toFixed(2)}` : '';

  const suffixLen = badge.length + tokStr.length + scoreStr.length + 2;
  const pathMaxLen = Math.max(10, cols - 8 - suffixLen);
  const displayPath = file.path.length > pathMaxLen
    ? '…' + file.path.slice(file.path.length - pathMaxLen + 1)
    : file.path;

  const rowText = `${depMarker}${checkbox} ${displayPath}${tokStr}${scoreStr}${badge}`;

  let color: (s: string) => string = Colors.normal;
  if (isCursor && isDep) color = (s) => Colors.cursor(Colors.dep(s));
  else if (isCursor)     color = Colors.cursor;
  else if (isDep)        color = Colors.dep;
  else if (isSelected)   color = Colors.selected;

  return <Text>{color(rowText)}</Text>;
}
