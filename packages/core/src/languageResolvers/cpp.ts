import fs from 'fs';
import path from 'path';
import type { LanguageResolver } from './types.js';

// Quoted: #include "foo.h" — local
const LOCAL_INCLUDE = /#include\s+"([^"]+)"/g;
// Angle bracket: #include <foo.h> — system
const SYSTEM_INCLUDE = /#include\s+<([^>]+)>/g;

export const cppResolver: LanguageResolver = {
  name: 'cpp',
  extensions: ['.c', '.h', '.cpp', '.hpp', '.cc', '.hh'],

  extractImports(content: string, _filePath: string): string[] {
    const specs: string[] = [];
    for (const m of content.matchAll(LOCAL_INCLUDE)) specs.push(`local:${m[1]}`);
    for (const m of content.matchAll(SYSTEM_INCLUDE)) specs.push(`system:${m[1]}`);
    return specs;
  },

  resolveImport(importSpec: string, fromFile: string, rootDir: string): string | null {
    if (importSpec.startsWith('system:')) return null;

    if (importSpec.startsWith('local:')) {
      const rel = importSpec.slice('local:'.length);
      const fromDir = path.dirname(fromFile);

      // Probe 1: relative to fromFile directory
      const fromDirCandidate = path.join(fromDir, rel).replace(/\\/g, '/');
      if (fs.existsSync(path.join(rootDir, fromDirCandidate))) return fromDirCandidate;

      // Probe 2: relative to rootDir
      if (fs.existsSync(path.join(rootDir, rel))) return rel;
    }

    return null;
  },
};
