import Ignore from 'ignore';
import fs from 'fs';
import path from 'path';
import type { IgnoreConfig } from '../types.js';

export const DEFAULT_PATTERNS = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  'out/**',
  '.next/**',
  '.nuxt/**',
  'coverage/**',
  '*.min.js',
  '*.bundle.js',
  '**/*.map',
];

export function resolveIgnorePatterns(root: string, config: IgnoreConfig): string[] {
  const patterns: string[] = [];

  if (config.useDefaultPatterns) {
    patterns.push(...DEFAULT_PATTERNS);
  }

  if (config.useGitignore) {
    const gitignorePath = path.join(root, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      patterns.push(...fs.readFileSync(gitignorePath, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean));
    }
  }

  const ccignorePath = path.join(root, '.repocodeignore');
  if (fs.existsSync(ccignorePath)) {
    patterns.push(...fs.readFileSync(ccignorePath, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean));
  }

  if (config.customPatterns.length > 0) {
    patterns.push(...config.customPatterns);
  }

  return patterns;
}

export async function buildIgnoreFilter(
  root: string,
  config: IgnoreConfig
): Promise<(filePath: string) => boolean> {
  const ig = Ignore();
  ig.add(resolveIgnorePatterns(root, config));

  return (filePath: string) => {
    const normalized = filePath.replace(/\\/g, '/');
    return !ig.ignores(normalized);
  };
}
