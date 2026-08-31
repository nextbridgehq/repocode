import fs from 'fs';
import path from 'path';
import type { LanguageResolver } from './types.js';

const GO_IMPORT_BLOCK = /import\s+\(([^)]+)\)/gs;
const GO_IMPORT_LINE = /"([\w./\-]+)"/g;
// Bare single-line form: `import "fmt"` — no parentheses, so GO_IMPORT_BLOCK misses it.
const GO_SINGLE_IMPORT = /import\s+(?:[\w.]+\s+)?"([\w./\-]+)"/g;

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
    for (const m of content.matchAll(GO_SINGLE_IMPORT)) {
      specs.push(m[1]);
    }
    return specs;
  },

  resolveImport(importSpec: string, _fromFile: string, rootDir: string): string | null {
    // Vendored dependency: Go's vendor/ directory mirrors the full import path verbatim.
    // Tried first — a verbatim vendor/ match is a high-confidence signal, whereas the
    // suffix-stripping fallback below can accidentally match an unrelated local directory
    // that happens to share a trailing path segment, which would be a wrong resolution
    // rather than a merely missing one.
    const vendored = `vendor/${importSpec}`;
    const vendoredAbs = path.join(rootDir, vendored);
    if (fs.existsSync(vendoredAbs) && fs.statSync(vendoredAbs).isDirectory()) {
      return vendored;
    }
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
