import fs from 'fs';
import path from 'path';
import type { LanguageResolver } from './types.js';

const STDLIB_ROOTS = ['System', 'Microsoft'];
const USING_STMT = /^\s*using\s+([\w.]+)\s*;/gm;
const SOURCE_ROOTS = ['', 'src', 'tests'];

function isStdlib(spec: string): boolean {
  return STDLIB_ROOTS.some(r => spec === r || spec.startsWith(r + '.'));
}

/** True if `absDir` is a directory containing at least one .cs file directly (non-recursive) —
 *  guards against a same-named but non-source directory (e.g. a docs/ folder or build output)
 *  shadowing the real namespace directory. */
function hasSourceFile(absDir: string): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some(e => e.isFile() && e.name.toLowerCase().endsWith('.cs'));
}

export const csharpResolver: LanguageResolver = {
  name: 'csharp',
  extensions: ['.cs'],

  extractImports(content: string, _filePath: string): string[] {
    const specs: string[] = [];
    for (const m of content.matchAll(USING_STMT)) {
      specs.push(m[1]);
    }
    return specs;
  },

  resolveImport(importSpec: string, _fromFile: string, rootDir: string): string | null {
    if (isStdlib(importSpec)) return null;

    // .NET project folders are conventionally named after the dotted assembly/namespace root
    // (e.g. `Acme.Billing.Core/Services/`), not just the namespace's first segment — so probe
    // progressively shorter dotted prefixes (most-specific first) rather than assuming every
    // dot is a directory boundary.
    const segments = importSpec.split('.');
    for (const root of SOURCE_ROOTS) {
      for (let dotted = segments.length; dotted >= 1; dotted--) {
        const dottedPart = segments.slice(0, dotted).join('.');
        const slashPart = segments.slice(dotted).join('/');
        const relPath = slashPart ? `${dottedPart}/${slashPart}` : dottedPart;
        const candidate = root ? `${root}/${relPath}` : relPath;
        const abs = path.join(rootDir, candidate);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(abs);
        } catch {
          continue;
        }
        if (stat.isDirectory() && hasSourceFile(abs)) {
          return candidate;
        }
      }
    }
    return null;
  },
};
