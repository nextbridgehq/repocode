import fs from 'fs';
import path from 'path';
import type { LanguageResolver } from './types.js';

const STDLIB_PREFIXES = ['java.', 'javax.', 'kotlin.', 'kotlinx.', 'android.', 'androidx.'];
const IMPORT_STMT = /^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/gm;
const SOURCE_ROOTS = [
  'src/main/java',
  'src/main/kotlin',
  'src',
  'app/src/main/java',
];

function isStdlib(spec: string): boolean {
  return STDLIB_PREFIXES.some(p => spec.startsWith(p));
}

export const javaResolver: LanguageResolver = {
  name: 'java',
  extensions: ['.java', '.kt', '.kts'],

  extractImports(content: string, _filePath: string): string[] {
    const specs: string[] = [];
    for (const m of content.matchAll(IMPORT_STMT)) {
      const spec = m[1];
      if (!spec.endsWith('.*')) specs.push(spec); // skip wildcard imports
    }
    return specs;
  },

  resolveImport(importSpec: string, _fromFile: string, rootDir: string): string | null {
    if (isStdlib(importSpec)) return null;

    const relPath = importSpec.replace(/\./g, '/');
    const candidates: string[] = [];
    for (const root of SOURCE_ROOTS) {
      candidates.push(`${root}/${relPath}.java`, `${root}/${relPath}.kt`);
    }

    for (const candidate of candidates) {
      if (fs.existsSync(path.join(rootDir, candidate))) {
        return candidate;
      }
    }
    return null;
  },
};
