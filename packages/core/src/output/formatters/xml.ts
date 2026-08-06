import type { AssembledContext } from '../assembler.js';

function wrapCdata(content: string): string {
  return `<![CDATA[${content.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatXml(ctx: AssembledContext): string {
  const parts: string[] = ['<repocode>'];

  if (ctx.preamble) {
    parts.push(`  <preamble>${ctx.preamble}</preamble>`);
  }

  parts.push('  <metadata>');
  parts.push(`    <generated>${ctx.header.generated}</generated>`);
  parts.push(`    <repository>${ctx.header.repository}</repository>`);
  parts.push(`    <tokens>${ctx.header.tokens}</tokens>`);
  if (ctx.header.budget) parts.push(`    <budget>${ctx.header.budget}</budget>`);
  parts.push('  </metadata>');

  if (ctx.instructions) {
    parts.push(`  <instructions>${wrapCdata(ctx.instructions)}</instructions>`);
  }

  if (ctx.tree) {
    parts.push(`  <directory_structure>\n${ctx.tree}\n  </directory_structure>`);
  }

  parts.push('  <files>');
  for (const file of ctx.files) {
    const safePath = escapeAttr(file.path);
    if (file.deleted) {
      parts.push(`    <file path="${safePath}" deleted="true">`);
      parts.push(`      ${wrapCdata('[DELETED]\n(File removed in this changeset)')}`);
      parts.push('    </file>');
    } else {
      const banner = file.compressionLevel === 'partial'
        ? '// [PARTIAL — signatures and key sections shown]\n'
        : file.compressionLevel === 'tier2-structural'
        ? '// [COMPRESSED — function bodies omitted]\n'
        : '';
      parts.push(`    <file path="${safePath}">`);
      parts.push(`      ${wrapCdata(banner + file.content)}`);
      parts.push('    </file>');
    }
  }
  parts.push('  </files>');
  parts.push('</repocode>');

  return parts.join('\n');
}
