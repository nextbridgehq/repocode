import fs from 'fs';
import path from 'path';
import type { LanguageResolver } from './types.js';

/** `from X import a, b` and `from X import (\n a,\n b as c\n)`. Group 1 is X, group 2 the names. */
const FROM_IMPORT = /^[ \t]*from\s+([\w.]+)\s+import\s+(\([^)]*\)|[^\n#]*)/gm;
/** `import a.b, c as d`. Group 1 is the module list. */
const IMPORT = /^[ \t]*import\s+([^\n#]+)/gm;

/** Directories a project keeps its top-level packages in, tried in order. `src/` is the
 *  packaging default (pytest, many libraries); without it no absolute import resolves. */
const SOURCE_ROOTS = ['', 'src/', 'lib/'];

function names(list: string): string[] {
  return list
    .replace(/[()\\]/g, ' ')
    .split(',')
    .map(n => n.trim().split(/\s+as\s+/)[0].trim())
    .filter(n => /^[\w.]+$/.test(n));
}

/** Whether the first path segment of `base` exists under rootDir, memoised. Most specifiers are
 *  stdlib or third-party (`os`, `typing`, `numpy`) and fail at their first segment; without the
 *  memo, trying three source roots cost 84,680 existsSync calls and 24 s on a cold django graph.
 *  ponytail: answers expire after TTL_MS so watch mode sees a package created mid-session;
 *  per-run invalidation if the resolver API ever gains a run hook. */
const TTL_MS = 30_000;
const topMemo = new Map<string, { exists: boolean; at: number }>();
function topExists(rootDir: string, base: string): boolean {
  // The top-level package, keeping a source-root prefix: "src/_pytest/nodes" → "src/_pytest".
  const m = /^((?:src|lib)\/)?([^/]+)/.exec(base);
  if (!m) return false;
  const top = (m[1] ?? '') + m[2];
  const key = rootDir + '\0' + top;
  const hit = topMemo.get(key);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.exists;
  const exists = fs.existsSync(path.join(rootDir, top)) || fs.existsSync(path.join(rootDir, top + '.py'));
  topMemo.set(key, { exists, at: now });
  return exists;
}

/** First existing file for a module path (slash form, no extension): a module, then a package.
 *  Memoised with the same expiry: the same specifier recurs in hundreds of files. */
const findMemo = new Map<string, { rel: string | null; at: number }>();
function findModule(rootDir: string, candidates: string[]): string | null {
  const key = rootDir + '\0' + candidates.join('\0');
  const hit = findMemo.get(key);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.rel;
  let found: string | null = null;
  outer: for (const base of candidates) {
    if (!topExists(rootDir, base)) continue;
    for (const rel of [base + '.py', base + '/__init__.py']) {
      if (fs.existsSync(path.join(rootDir, rel))) { found = rel; break outer; }
    }
  }
  findMemo.set(key, { rel: found, at: now });
  return found;
}

export const pythonResolver: LanguageResolver = {
  name: 'python',
  extensions: ['.py'],

  /** Specifiers include `X.name` for every name in `from X import name`: the name may be a
   *  submodule (`from django.db.models import query`), and resolveImport returns null when it
   *  is a class or function instead. */
  extractImports(content: string, _filePath: string): string[] {
    const specs: string[] = [];
    for (const m of content.matchAll(FROM_IMPORT)) {
      const mod = m[1];
      if (!/^\.+$/.test(mod)) specs.push(mod);
      const sep = mod.endsWith('.') ? '' : '.';
      for (const n of names(m[2])) if (n !== '*') specs.push(mod + sep + n);
    }
    for (const m of content.matchAll(IMPORT)) specs.push(...names(m[1]));
    return specs;
  },

  resolveImport(importSpec: string, fromFile: string, rootDir: string): string | null {
    // Relative import: leading dots anchor to the importing file's own package (its
    // directory), one extra level up per additional dot — not to the repository root.
    if (importSpec.startsWith('.')) {
      let dots = 0;
      while (dots < importSpec.length && importSpec[dots] === '.') dots++;
      const rest = importSpec.slice(dots);
      if (!rest) return null;
      let dir = path.dirname(fromFile);
      for (let i = 1; i < dots; i++) dir = path.dirname(dir);
      const base = path.join(dir, rest.replace(/\./g, '/')).replace(/\\/g, '/').replace(/^\.\//, '');
      return findModule(rootDir, [base]);
    }

    const mod = importSpec.replace(/\./g, '/');
    return findModule(rootDir, SOURCE_ROOTS.map(r => r + mod));
  },
};
