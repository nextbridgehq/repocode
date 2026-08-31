import fs from 'fs';
import path from 'path';
import type { LanguageResolver } from './types.js';

const PATTERNS = [
  /import\s+[\s\S]*?\s+from\s+['"](.+?)['"]/g,
  /export\s+[\s\S]*?\s+from\s+['"](.+?)['"]/g,
  /(?:require|import)\s*\(\s*['"](.+?)['"]\s*\)/g,
];

/** Probe the extension/index variants of one base path, returning a root-relative hit. */
function probeCandidates(basePath: string, rootDir: string): string | null {
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

function resolveRelative(spec: string, fromDir: string, rootDir: string): string | null {
  if (!spec.startsWith('.')) return null;
  return probeCandidates(path.resolve(fromDir, spec), rootDir);
}

/** Strip `//` and block comments plus trailing commas so JSON.parse accepts a tsconfig.
 *  Deliberately simple: anything it mangles just fails to parse and falls back to no aliases. */
function stripJsonComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'\\])\/\/.*$/gm, '$1')
    .replace(/,(\s*[}\]])/g, '$1');
}

interface AliasConfig {
  baseUrl: string;
  paths: Record<string, string[]>;
}

// Config is read once per root: resolveImport runs for every import spec in the repo.
const aliasCache = new Map<string, AliasConfig>();

function loadAliasConfig(rootDir: string): AliasConfig {
  const cached = aliasCache.get(rootDir);
  if (cached) return cached;

  let config: AliasConfig = { baseUrl: '.', paths: {} };
  // Only the root config is read — an `extends` chain's paths are not resolved.
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    try {
      const raw = fs.readFileSync(path.join(rootDir, name), 'utf-8');
      const parsed = JSON.parse(stripJsonComments(raw));
      const paths = parsed?.compilerOptions?.paths;
      if (paths && typeof paths === 'object') {
        config = {
          baseUrl: typeof parsed?.compilerOptions?.baseUrl === 'string'
            ? parsed.compilerOptions.baseUrl
            : '.',
          paths: paths as Record<string, string[]>,
        };
        break;
      }
    } catch {
      // Missing or unparseable config — try the next name, else fall through to no aliases.
    }
  }

  aliasCache.set(rootDir, config);
  return config;
}

/** Resolve a non-relative spec through tsconfig `paths`, which are relative to `baseUrl`.
 *  Supports the single-`*` wildcard shape (`"@app/*": ["app/*"]`) and exact keys. */
function resolveAlias(spec: string, rootDir: string): string | null {
  const { baseUrl, paths } = loadAliasConfig(rootDir);

  for (const [pattern, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets)) continue;
    const star = pattern.indexOf('*');

    if (star === -1) {
      if (spec !== pattern) continue;
      for (const target of targets) {
        const hit = probeCandidates(path.resolve(rootDir, baseUrl, target), rootDir);
        if (hit && !hit.startsWith('../')) return hit;
      }
      continue;
    }

    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (spec.length < prefix.length + suffix.length) continue;
    if (!spec.startsWith(prefix) || !spec.endsWith(suffix)) continue;

    const matched = spec.slice(prefix.length, spec.length - suffix.length);
    for (const target of targets) {
      const hit = probeCandidates(
        path.resolve(rootDir, baseUrl, target.replace('*', matched)),
        rootDir,
      );
      if (hit && !hit.startsWith('../')) return hit;
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
    const relative = resolveRelative(importSpec, fromDir, rootDir);
    if (relative) return relative;
    // A relative spec that didn't resolve is simply missing — aliases never apply to it.
    if (importSpec.startsWith('.')) return null;
    return resolveAlias(importSpec, rootDir);
  },
};
