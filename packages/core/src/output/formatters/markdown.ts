import type { AssembledContext } from '../assembler.js';

function pickFence(content: string): string {
  const matches = content.match(/`{3,}/g);
  const longest = matches ? Math.max(...matches.map(m => m.length)) : 0;
  return '`'.repeat(Math.max(3, longest + 1));
}

export function formatMarkdown(ctx: AssembledContext): string {
  const parts: string[] = [];

  parts.push(`# RepoCode Output`);
  // Token total, file count and timestamp all move whenever content does, and this line sits
  // above every file body — so in cache-stable mode the summary is dropped rather than
  // guaranteeing a miss on every repack.
  if (!ctx.omitVolatileMetadata) {
    parts.push(`> ${ctx.header.tokens.toLocaleString()} tokens${ctx.header.budget ? ` / ${ctx.header.budget.toLocaleString()}` : ''} | ${ctx.header.fileCount} files${ctx.header.generated ? ` | ${ctx.header.generated}` : ''}`);
  }
  parts.push('');

  if (ctx.preamble) {
    parts.push(`> ${ctx.preamble}`);
    parts.push('');
  }

  if (ctx.instructions) {
    parts.push('## Instructions');
    parts.push('');
    parts.push(ctx.instructions);
    parts.push('');
  }

  if (ctx.tree) {
    parts.push('## Directory Structure');
    parts.push('');
    parts.push('```');
    parts.push(ctx.tree);
    parts.push('```');
    parts.push('');
  }

  parts.push('## Files');
  parts.push('');
  for (const file of ctx.files) {
    if (file.deleted) {
      parts.push(`### \`${file.path}\` [DELETED]`);
      parts.push('');
      parts.push('(File removed in this changeset)');
      parts.push('');
    } else {
      const banner = file.compressionLevel === 'partial'
        ? '// [PARTIAL — signatures and key sections shown]\n'
        : file.compressionLevel === 'tier2-structural'
        ? '// [COMPRESSED — function bodies omitted]\n'
        : '';
      const body = banner + file.content;
      const fence = pickFence(body);
      parts.push(`### \`${file.path}\``);
      parts.push('');
      parts.push(`${fence}${file.language ?? ''}`);
      parts.push(body);
      parts.push(fence);
      parts.push('');
    }
  }

  return parts.join('\n');
}
