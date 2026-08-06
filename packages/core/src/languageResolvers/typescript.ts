import fs from 'fs';
import path from 'path';
import type { LanguageResolver } from './types.js';

const PATTERNS = [
  /import\s+[\s\S]*?\s+from\s+['"](.+?)['"]/g,
  /export\s+[\s\S]*?\s+from\s+['"](.+?)['"]/g,
  /(?:require|import)\s*\(\s*['"](.+?)['"]\s*\)/g,
];

function resolveRelative(spec: string, fromDir: string, rootDir: string): string | null {
  if (!spec.startsWith('.')) return null;
  const basePath = path.resolve(fromDir, spec);
  const candidates = [
    basePath,
    basePath.replace(/\.js$/, '.ts'),
    basePath.replace(/\.js$/, '.tsx'),
    basePath + '.ts', basePath + '.tsx', basePath + '.js', basePath + '.jsx',
    path.join(basePath, 'index.ts'), path.join(basePath, 'index.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.relative(rootDir, candidate).replace(/\\/g, '/');
    }
  }
  return null;
}

export const tsResolver: LanguageResolver = {
  name: 'typescript',
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cts', '.cjs'],

  extractImports(content: string, _filePath: string): string[] {
    const specs: string[] = [];
    for (const pat of PATTERNS) {
      for (const m of content.matchAll(pat)) specs.push(m[1]);
    }
    return specs;
  },

  resolveImport(importSpec: string, fromFile: string, rootDir: string): string | null {
    const fromDir = path.dirname(path.resolve(rootDir, fromFile));
    return resolveRelative(importSpec, fromDir, rootDir);
  },
};
