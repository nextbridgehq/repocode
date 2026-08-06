import fs from 'fs';
import path from 'path';
import type { LanguageResolver } from './types.js';

const STDLIB_PREFIXES = ['std::', 'core::', 'alloc::'];

// Match: mod foo; (module declarations)
const MOD_DECL = /\bmod\s+(\w+)\s*;/g;
// Match: use crate::, use super::, use self:: paths
const USE_PATH = /\buse\s+((?:crate|super|self)::[\w:]+)/g;
// Match: extern crate foo;
const EXTERN_CRATE = /\bextern\s+crate\s+(\w+)/g;

export const rustResolver: LanguageResolver = {
  name: 'rust',
  extensions: ['.rs'],

  extractImports(content: string, _filePath: string): string[] {
    const specs: string[] = [];
    for (const m of content.matchAll(MOD_DECL)) specs.push(`mod:${m[1]}`);
    for (const m of content.matchAll(USE_PATH)) specs.push(m[1]);
    for (const m of content.matchAll(EXTERN_CRATE)) specs.push(`extern:${m[1]}`);
    return specs;
  },

  resolveImport(importSpec: string, fromFile: string, rootDir: string): string | null {
    // External crates
    if (importSpec.startsWith('extern:')) return null;
    // Stdlib
    if (STDLIB_PREFIXES.some(p => importSpec.startsWith(p))) return null;

    const fromDir = path.dirname(fromFile);

    // mod foo; — look for <fromDir>/foo.rs or <fromDir>/foo/mod.rs
    if (importSpec.startsWith('mod:')) {
      const modName = importSpec.slice(4);
      const candidates = [
        path.join(fromDir, `${modName}.rs`),
        path.join(fromDir, modName, 'mod.rs'),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(path.join(rootDir, candidate))) {
          return candidate.replace(/\\/g, '/');
        }
      }
      return null;
    }

    // use crate::foo::bar — strip crate::, convert :: to /, probe src/<path>.rs
    if (importSpec.startsWith('crate::')) {
      const rel = importSpec.slice('crate::'.length).replace(/::/g, '/');
      // Try to resolve to a file: probe the module path, then the last segment as a file
      const segments = rel.split('/');
      for (let end = segments.length; end >= 1; end--) {
        const filePath = `src/${segments.slice(0, end).join('/')}.rs`;
        if (fs.existsSync(path.join(rootDir, filePath))) {
          return filePath;
        }
      }
      return null;
    }

    // use super::foo — resolve relative to parent directory
    if (importSpec.startsWith('super::')) {
      const rel = importSpec.slice('super::'.length).replace(/::/g, '/');
      const parentDir = path.dirname(fromDir);
      const candidate = path.join(parentDir, `${rel}.rs`).replace(/\\/g, '/');
      if (fs.existsSync(path.join(rootDir, candidate))) return candidate;
      return null;
    }

    // use self::foo — resolve relative to current directory
    if (importSpec.startsWith('self::')) {
      const rel = importSpec.slice('self::'.length).replace(/::/g, '/');
      const candidate = path.join(fromDir, `${rel}.rs`).replace(/\\/g, '/');
      if (fs.existsSync(path.join(rootDir, candidate))) return candidate;
      return null;
    }

    return null;
  },
};
