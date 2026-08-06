import React from 'react';
import { Box } from 'ink';
import { FileRow } from './FileRow.js';
import type { TUIFile } from '@repocode/core';

interface FileListProps {
  files: TUIFile[];
  cursor: number;
  selected: Set<string>;
  depFiles: Set<string>;
  gitStatuses: Map<string, 'M' | 'A' | 'D' | '?'>;
  visibleRows: number;
  cols: number;
}

export function FileList({ files, cursor, selected, depFiles, gitStatuses, visibleRows, cols }: FileListProps) {
  // Compute scroll offset: keep cursor centered in the visible window
  const half   = Math.floor(visibleRows / 2);
  const maxOff = Math.max(0, files.length - visibleRows);
  const offset = Math.min(maxOff, Math.max(0, cursor - half));

  const visible = files.slice(offset, offset + visibleRows);

  return (
    <Box flexDirection="column">
      {visible.map((file, i) => (
        <FileRow
          key={file.path}
          file={file}
          isSelected={selected.has(file.path)}
          isCursor={offset + i === cursor}
          isDep={depFiles.has(file.path)}
          gitStatus={gitStatuses.get(file.path)}
          cols={cols}
        />
      ))}
    </Box>
  );
}
