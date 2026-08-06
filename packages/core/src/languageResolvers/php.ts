import fs from 'fs';
import path from 'path';
import type { LanguageResolver } from './types.js';

// use App\Models\User; (optionally with `as Alias`)
const USE_STMT = /^\s*use\s+([\w\\]+)(?:\s+as\s+\w+)?\s*;/gm;
// require/include with a literal (non-interpolated) string
const REQ_LITERAL = /\b(?:require|require_once|include|include_once)\s+['"]([^'"$]+)['"]/g;

type Psr4Map = Record<string, string>; // namespace prefix → directory

function loadPsr4Map(rootDir: string): Psr4Map {
  const composerPath = path.join(rootDir, 'composer.json');
  try {
    const composer = JSON.parse(fs.readFileSync(composerPath, 'utf-8'));
    return (composer?.autoload?.['psr-4'] ?? {}) as Psr4Map;
  } catch {
    return {};
  }
}

function resolveNamespace(ns: string, rootDir: string): string | null {
  const psr4 = loadPsr4Map(rootDir);

  // Sort by length descending so more-specific prefixes match first
  const prefixes = Object.keys(psr4).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    const normalizedPrefix = prefix.replace(/\\+$/, ''); // strip trailing backslash
    if (ns.startsWith(normalizedPrefix + '\\') || ns === normalizedPrefix) {
      const dir = (psr4[prefix] as string).replace(/\/$/, '');
      const rest = ns.slice(normalizedPrefix.length).replace(/^\\/, '').replace(/\\/g, '/');
      const candidate = rest ? `${dir}/${rest}.php` : `${dir}.php`;
      if (fs.existsSync(path.join(rootDir, candidate))) return candidate;
      return null;
    }
  }

  // Fallback: convert namespace separators to path and search
  const relPath = ns.replace(/\\/g, '/');
  const className = relPath.split('/').pop()!;
  // Bounded glob fallback: search up to depth 8
  function findFile(dir: string, depth: number): string | null {
    if (depth <= 0) return null;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const found = findFile(path.join(dir, entry.name), depth - 1);
        if (found) return found;
      } else if (entry.name === `${className}.php`) {
        return path.relative(rootDir, path.join(dir, entry.name)).replace(/\\/g, '/');
      }
    }
    return null;
  }
  try {
    return findFile(rootDir, 8);
  } catch {
    return null;
  }
}

export const phpResolver: LanguageResolver = {
  name: 'php',
  extensions: ['.php'],

  extractImports(content: string, _filePath: string): string[] {
    const specs: string[] = [];
    for (const m of content.matchAll(USE_STMT)) specs.push(`ns:${m[1]}`);
    for (const m of content.matchAll(REQ_LITERAL)) specs.push(`req:${m[1]}`);
    return specs;
  },

  resolveImport(importSpec: string, fromFile: string, rootDir: string): string | null {
    if (importSpec.startsWith('ns:')) {
      return resolveNamespace(importSpec.slice(3), rootDir);
    }

    if (importSpec.startsWith('req:')) {
      const rel = importSpec.slice(4);
      const fromDir = path.dirname(fromFile);
      const candidate = path.join(fromDir, rel).replace(/\\/g, '/');
      if (fs.existsSync(path.join(rootDir, candidate))) return candidate;
      // Also probe rootDir directly for bare filenames
      if (fs.existsSync(path.join(rootDir, rel))) return rel;
    }

    return null;
  },
};
