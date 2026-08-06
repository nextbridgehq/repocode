import { isBinary } from 'istextorbinary';
import fs from 'fs';
import path from 'path';
import type { DiscoveredFile, ExcludedFile } from '../types.js';
import { LANGUAGE_MAP } from './fileDiscovery.js';

export async function stdinDiscovery(
  lines: string[],
  root: string,
): Promise<{ files: DiscoveredFile[]; excluded: ExcludedFile[] }> {
  const files: DiscoveredFile[] = [];
  const excluded: ExcludedFile[] = [];

  for (const line of lines) {
    const absPath = path.resolve(root, line);
    const relPath = path.relative(root, absPath).replace(/\\/g, '/');

    if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
      excluded.push({ path: line, reason: 'outside-root' });
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(absPath);
    } catch {
      excluded.push({ path: line, reason: 'not-found' });
      continue;
    }

    if (!stat.isFile()) {
      excluded.push({ path: line, reason: 'not-found' });
      continue;
    }

    const ext = path.extname(relPath).slice(1).toLowerCase();
    const language = LANGUAGE_MAP[ext] ?? null;

    let binary: boolean;
    const binaryByName = isBinary(path.basename(relPath));
    if (binaryByName !== null) {
      binary = binaryByName;
    } else {
      try {
        const buf = fs.readFileSync(absPath);
        const binaryByBuf = isBinary(null, buf);
        binary = binaryByBuf ?? false;
      } catch {
        binary = true;
      }
    }

    files.push({
      path: relPath,
      absolutePath: absPath,
      size: stat.size,
      language,
      mtime: stat.mtime,
      isBinary: binary,
      source: 'normal',
    });
  }

  return { files, excluded };
}
