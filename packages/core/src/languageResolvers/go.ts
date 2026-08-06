import fs from 'fs';
import path from 'path';
import type { LanguageResolver } from './types.js';

const GO_IMPORT_BLOCK = /import\s+\(([^)]+)\)/gs;
const GO_IMPORT_LINE = /"([\w./\-]+)"/g;

export const goResolver: LanguageResolver = {
  name: 'go',
  extensions: ['.go'],

  extractImports(content: string, _filePath: string): string[] {
    const specs: string[] = [];
    for (const blockMatch of content.matchAll(GO_IMPORT_BLOCK)) {
      for (const m of blockMatch[1].matchAll(GO_IMPORT_LINE)) {
        specs.push(m[1]);
      }
    }
    return specs;
  },

  resolveImport(importSpec: string, _fromFile: string, rootDir: string): string | null {
    const parts = importSpec.split('/');
    for (let start = 0; start < parts.length; start++) {
      const candidate = parts.slice(start).join('/');
      const abs = path.join(rootDir, candidate);
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        return candidate;
      }
    }
    return null;
  },
};
