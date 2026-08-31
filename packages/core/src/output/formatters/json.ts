import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { AssembledContext } from '../assembler.js';

// Walks upward from this file's directory to find the nearest package.json
// with a version field, instead of assuming a fixed number of `..` segments.
// A fixed offset breaks whenever this module is bundled somewhere else in
// the directory tree (e.g. by an external bundler), which shifts
// import.meta.url — and therefore __dirname — to a different depth.
function readNearestPackageVersion(startDir: string, maxLevels = 6): string {
  let dir = startDir;
  for (let i = 0; i < maxLevels; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // no package.json at this level, or it has no version — keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_VERSION = readNearestPackageVersion(__dirname);

export function formatJson(ctx: AssembledContext): string {
  return JSON.stringify({
    metadata: {
      version: PACKAGE_VERSION,
      ...(ctx.header.generated ? { generated: ctx.header.generated } : {}),
      repository: ctx.header.repository,
      ...(ctx.omitVolatileMetadata ? {} : { tokens: ctx.header.tokens }),
      budget: ctx.header.budget ?? null,
      ...(ctx.omitVolatileMetadata ? {} : { fileCount: ctx.header.fileCount }),
    },
    preamble: ctx.preamble || null,
    instructions: ctx.instructions || null,
    tree: ctx.tree || null,
    files: ctx.files.map(f => ({
      path: f.path,
      language: f.language,
      tokens: f.tokens,
      rank: f.rank,
      compressed: f.compressed,
      compressionLevel: f.compressionLevel ?? 'none',
      deleted: f.deleted ?? false,
      ...(ctx.includeScores ? { score: f.score, signals: f.signals } : {}),
      content: f.content,
    })),
  }, null, 2);
}
