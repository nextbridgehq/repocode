import type { AssembledContext } from '../assembler.js';

const SEPARATOR = '='.repeat(64);

export function formatPlain(ctx: AssembledContext): string {
  const parts: string[] = [];
  parts.push(SEPARATOR);
  parts.push(`RepoCode | ${ctx.header.tokens.toLocaleString()} tokens | ${ctx.header.fileCount} files`);
  parts.push(SEPARATOR);
  parts.push('');

  if (ctx.preamble) {
    parts.push(ctx.preamble);
    parts.push('');
  }

  if (ctx.instructions) {
    parts.push('--- Instructions ---');
    parts.push(ctx.instructions);
    parts.push('');
  }

  if (ctx.tree) {
    parts.push('--- Tree ---');
    parts.push(ctx.tree);
    parts.push('');
  }

  for (const file of ctx.files) {
    if (file.deleted) {
      parts.push(`--- ${file.path} [DELETED] ---`);
      parts.push('(File removed in this changeset)');
      parts.push('');
    } else {
      const banner = file.compressionLevel === 'partial'
        ? '// [PARTIAL — signatures and key sections shown]\n'
        : file.compressionLevel === 'tier2-structural'
        ? '// [COMPRESSED — function bodies omitted]\n'
        : '';
      parts.push(`--- ${file.path} ---`);
      parts.push(banner + file.content);
      parts.push('');
    }
  }

  return parts.join('\n');
}
