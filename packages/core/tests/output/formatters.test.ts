import { describe, it, expect } from 'vitest';
import { formatXml } from '../../src/output/formatters/xml.js';
import { formatMarkdown } from '../../src/output/formatters/markdown.js';
import { formatPlain } from '../../src/output/formatters/plain.js';
import { formatJson } from '../../src/output/formatters/json.js';
import type { AssembledContext } from '../../src/output/assembler.js';

const sample: AssembledContext = {
  preamble: 'Test preamble.',
  header: { generated: '2025-01-01', repository: 'test-repo', tokens: 100, budget: 1000, fileCount: 1 },
  instructions: '',
  tree: 'src/\n└── foo.ts',
  includeScores: false,
  files: [{ path: 'src/foo.ts', language: 'typescript', tokens: 100, rank: 1, content: 'const x = 1;', compressed: false }],
};

describe('formatXml', () => {
  it('wraps output in <repocode>', () => {
    const out = formatXml(sample);
    expect(out).toContain('<repocode>');
    expect(out).toContain('</repocode>');
  });

  it('uses CDATA for file content', () => {
    const out = formatXml(sample);
    expect(out).toContain('<![CDATA[');
    expect(out).toContain(']]>');
  });

  it('escapes ]]> in file content', () => {
    const s = { ...sample, files: [{ ...sample.files[0], content: 'a]]>b' }] };
    const out = formatXml(s);
    expect(out).not.toContain('a]]>b');
    expect(out).toContain('a]]]]><![CDATA[>b');
  });
});

describe('formatMarkdown', () => {
  it('includes a top-level heading', () => {
    expect(formatMarkdown(sample)).toContain('# RepoCode Output');
  });

  it('wraps file content in a fenced code block', () => {
    const out = formatMarkdown(sample);
    expect(out).toContain('```typescript');
    expect(out).toContain('```');
  });
});

describe('formatXml — path attribute escaping', () => {
  it('escapes double quotes in the file path attribute', () => {
    const ctx = { ...sample, files: [{ ...sample.files[0], path: 'src/weird"file.ts' }] };
    const out = formatXml(ctx);
    expect(out).toContain('path="src/weird&quot;file.ts"');
    expect(out).not.toContain('path="src/weird"file.ts"');
  });

  it('escapes ampersands and angle brackets in the file path attribute', () => {
    const ctx = { ...sample, files: [{ ...sample.files[0], path: 'src/a&b<c>.ts' }] };
    const out = formatXml(ctx);
    expect(out).toContain('path="src/a&amp;b&lt;c&gt;.ts"');
  });
});

describe('formatMarkdown — fence safety', () => {
  it('uses a longer fence when file content contains a triple-backtick line', () => {
    const ctx = { ...sample, files: [{ ...sample.files[0], content: 'const a = 1;\n```\nconst b = 2;' }] };
    const out = formatMarkdown(ctx);
    expect(out).toContain('````typescript');
    expect(out).toContain('const a = 1;\n```\nconst b = 2;');
    // The content's own ``` must not be interpreted as the closing fence — the fence line count must be exactly 2
    const fenceLines = out.split('\n').filter(l => /^`{4,}/.test(l));
    expect(fenceLines.length).toBe(2);
  });

  it('uses the default triple-backtick fence when content has no backticks', () => {
    const out = formatMarkdown(sample);
    expect(out).toContain('```typescript');
    expect(out).not.toContain('````');
  });
});

describe('formatPlain', () => {
  it('separates files with === delimiters', () => {
    const out = formatPlain(sample);
    expect(out).toContain('===');
    expect(out).toContain('src/foo.ts');
    expect(out).toContain('const x = 1;');
  });
});

describe('formatJson', () => {
  it('produces valid JSON', () => {
    const out = formatJson(sample);
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('includes files array with path and content', () => {
    const parsed = JSON.parse(formatJson(sample));
    expect(parsed.files[0].path).toBe('src/foo.ts');
    expect(parsed.files[0].content).toBe('const x = 1;');
  });
});

describe('deleted file stub rendering', () => {
  const deletedCtx: AssembledContext = {
    preamble: '',
    header: { generated: '2026-01-01T00:00:00.000Z', repository: 'test', tokens: 0, budget: null, fileCount: 1 },
    instructions: '',
    tree: '',
    includeScores: false,
    files: [{
      path: 'src/old-provider.ts',
      language: 'typescript',
      tokens: 0,
      rank: 1,
      content: '[DELETED]',
      compressed: false,
      deleted: true,
    }],
  };

  it('XML: renders deleted attribute and stub content', () => {
    const out = formatXml(deletedCtx);
    expect(out).toContain('deleted="true"');
    expect(out).toContain('[DELETED]');
    expect(out).toContain('src/old-provider.ts');
  });

  it('Markdown: renders [DELETED] in heading', () => {
    const out = formatMarkdown(deletedCtx);
    expect(out).toContain('[DELETED]');
    expect(out).toContain('src/old-provider.ts');
    expect(out).toContain('File removed');
  });

  it('Plain: renders [DELETED] marker in separator', () => {
    const out = formatPlain(deletedCtx);
    expect(out).toContain('[DELETED]');
    expect(out).toContain('src/old-provider.ts');
  });

  it('JSON: renders deleted: true on file object', () => {
    const out = formatJson(deletedCtx);
    const parsed = JSON.parse(out);
    const f = parsed.files[0];
    expect(f.deleted).toBe(true);
    expect(f.path).toBe('src/old-provider.ts');
  });
});

describe('compression/partial annotation', () => {
  function makeAnnotatedCtx(compressionLevel: 'tier2-structural' | 'partial'): AssembledContext {
    return {
      preamble: '',
      header: { generated: '2026-01-01T00:00:00.000Z', repository: 'test', tokens: 100, budget: null, fileCount: 1 },
      instructions: '',
      tree: '',
      includeScores: false,
      files: [{
        path: 'src/foo.ts',
        language: 'typescript',
        tokens: 100,
        rank: 1,
        content: 'function f(): void { /* ... */ }',
        compressed: true,
        compressionLevel,
      }],
    };
  }

  it('formatXml: output is valid XML (parseable) with partial annotation inside CDATA', () => {
    const out = formatXml(makeAnnotatedCtx('partial'));
    // Should be parseable XML
    expect(out).toContain('<repocode>');
    expect(out).toContain('</repocode>');
    // Annotation present inside CDATA
    expect(out).toContain('[PARTIAL');
    // No raw ]]> that would break CDATA (the wrapCdata function handles this)
    const cdataContent = out.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] ?? '';
    expect(cdataContent).not.toContain(']]>');
  });

  it('formatMarkdown: annotation is inside the code fence', () => {
    const out = formatMarkdown(makeAnnotatedCtx('partial'));
    const fenceStart = out.indexOf('```typescript');
    const fenceEnd = out.indexOf('\n```', fenceStart + 1);
    const insideFence = out.slice(fenceStart, fenceEnd);
    expect(insideFence).toContain('[PARTIAL');
  });

  it('formatJson: compressionLevel field present on file object', () => {
    const out = formatJson(makeAnnotatedCtx('tier2-structural'));
    const parsed = JSON.parse(out);
    expect(parsed.files[0].compressionLevel).toBe('tier2-structural');
  });

  it('no annotation when compressionLevel is "none"', () => {
    const ctx: AssembledContext = {
      preamble: '',
      header: { generated: '2026-01-01T00:00:00.000Z', repository: 'test', tokens: 10, budget: null, fileCount: 1 },
      instructions: '',
      tree: '',
      includeScores: false,
      files: [{ path: 'src/a.ts', language: 'typescript', tokens: 10, rank: 1, content: 'const x = 1;', compressed: false, compressionLevel: 'none' }],
    };
    expect(formatMarkdown(ctx)).not.toContain('[PARTIAL');
    expect(formatMarkdown(ctx)).not.toContain('[COMPRESSED');
  });
});

