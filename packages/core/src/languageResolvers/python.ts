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

  resolveImport(importSpec: string, fromFile: string, rootDir: string): string | null {
    // Relative import: leading dots anchor to the importing file's own package (its
    // directory), one extra level up per additional dot — not to the repository root.
    if (importSpec.startsWith('.')) {
      let dots = 0;
      while (dots < importSpec.length && importSpec[dots] === '.') dots++;
      const rest = importSpec.slice(dots);
      // `from . import x` names no module after the dots — the imported symbol may or may
      // not be a submodule, the same ambiguity absolute imports have. Documented as unsupported.
      if (!rest) return null;
      let dir = path.dirname(fromFile);
      for (let i = 1; i < dots; i++) dir = path.dirname(dir);
      const relPath = path.join(dir, rest.replace(/\./g, '/') + '.py').replace(/\\/g, '/');
      if (fs.existsSync(path.join(rootDir, relPath))) return relPath;
      return null;
    }

    const filePath = importSpec.replace(/\./g, '/') + '.py';
    if (fs.existsSync(path.join(rootDir, filePath))) return filePath;
    return null;
  },
};
