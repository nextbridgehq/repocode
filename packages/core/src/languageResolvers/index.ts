import path from 'path';
import type { LanguageResolver } from './types.js';
import { tsResolver } from './typescript.js';
import { pythonResolver } from './python.js';
import { goResolver } from './go.js';
import { rustResolver } from './rust.js';
import { rubyResolver } from './ruby.js';
import { javaResolver } from './java.js';
import { cppResolver } from './cpp.js';
import { phpResolver } from './php.js';
import { csharpResolver } from './csharp.js';

const resolvers: LanguageResolver[] = [
  tsResolver, pythonResolver, goResolver, rustResolver, rubyResolver, javaResolver, cppResolver, phpResolver, csharpResolver,
];

const byExtension = new Map<string, LanguageResolver>();
for (const r of resolvers) {
  for (const ext of r.extensions) {
    if (!byExtension.has(ext)) byExtension.set(ext, r); // first-registered wins
  }
}

/** Glob pattern matching all supported source files — import this in importTracer.ts and graphBuilder.ts */
export const SOURCE_GLOB = byExtension.size > 0
  ? `**/*.{${[...byExtension.keys()].map(e => e.slice(1)).join(',')}}`
  : '**/*.{ts}'; // fallback until resolvers are registered (Tasks 2–9)

export function getResolver(filePath: string): LanguageResolver | null {
  return byExtension.get(path.extname(filePath).toLowerCase()) ?? null;
}
