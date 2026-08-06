import fs from 'fs';
import path from 'path';
import type { LanguageResolver } from './types.js';

// require_relative 'path' or require_relative "path"
const REQ_RELATIVE = /\brequire_relative\s+['"]([^'"]+)['"]/g;
// require 'name' — bare name (no ./ or ../) means gem
const REQ_BARE = /\brequire\s+['"]([^'"]+)['"]/g;
// load 'file' — literal string
const LOAD = /\bload\s+['"]([^'"]+)['"]/g;

export const rubyResolver: LanguageResolver = {
  name: 'ruby',
  extensions: ['.rb'],

  extractImports(content: string, _filePath: string): string[] {
    const specs: string[] = [];
    for (const m of content.matchAll(REQ_RELATIVE)) specs.push(`relative:${m[1]}`);
    for (const m of content.matchAll(REQ_BARE)) {
      const spec = m[1];
      // require './foo' (explicit dot-slash) is relative; bare names are gems
      if (spec.startsWith('./') || spec.startsWith('../')) {
        specs.push(`relative:${spec}`);
      } else {
        specs.push(`gem:${spec}`);
      }
    }
    for (const m of content.matchAll(LOAD)) specs.push(`load:${m[1]}`);
    return specs;
  },

  resolveImport(importSpec: string, fromFile: string, rootDir: string): string | null {
    if (importSpec.startsWith('gem:')) return null;

    const fromDir = path.dirname(fromFile);

    if (importSpec.startsWith('relative:')) {
      const rel = importSpec.slice('relative:'.length);
      const withExt = rel.endsWith('.rb') ? rel : `${rel}.rb`;
      const candidate = path.join(fromDir, withExt).replace(/\\/g, '/');
      if (fs.existsSync(path.join(rootDir, candidate))) return candidate;
      return null;
    }

    if (importSpec.startsWith('load:')) {
      const rel = importSpec.slice('load:'.length);
      const candidate = path.join(fromDir, rel).replace(/\\/g, '/');
      if (fs.existsSync(path.join(rootDir, candidate))) return candidate;
      return null;
    }

    return null;
  },
};
