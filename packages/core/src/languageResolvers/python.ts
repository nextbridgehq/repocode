import fs from 'fs';
import path from 'path';
import type { LanguageResolver } from './types.js';

const PYTHON_PATTERNS = [
  /^from\s+([\w.]+)\s+import/gm,
  /^import\s+([\w.]+)/gm,
];

export const pythonResolver: LanguageResolver = {
  name: 'python',
  extensions: ['.py'],

  extractImports(content: string, _filePath: string): string[] {
    const specs: string[] = [];
    for (const pat of PYTHON_PATTERNS) {
      for (const m of content.matchAll(pat)) specs.push(m[1]);
    }
    return specs;
  },

  resolveImport(importSpec: string, _fromFile: string, rootDir: string): string | null {
    const filePath = importSpec.replace(/\./g, '/') + '.py';
    if (fs.existsSync(path.join(rootDir, filePath))) return filePath;
    return null;
  },
};
