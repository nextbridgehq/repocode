import { fileURLToPath } from 'url';
import { Parser, Language } from 'web-tree-sitter';
import type { Tree } from 'web-tree-sitter';

/** Grammars shipped in `grammars/`, picked by file extension. The `typescript` language name used
 *  elsewhere covers .ts, .tsx and .jsx, which need different grammars. */
const GRAMMAR_BY_EXT: Record<string, string> = {
  py: 'python', go: 'go', rs: 'rust', java: 'java',
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
};

/** Parsing is O(file); beyond this the file is generated or vendored data, not code worth focusing. */
const MAX_PARSE_BYTES = 2 * 1024 * 1024;

const GRAMMAR_DIR = fileURLToPath(new URL('../../grammars/', import.meta.url));

let parser: Promise<Parser> | null = null;
const languages = new Map<string, Promise<Language>>();

export function grammarFor(filePath: string): string | null {
  const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();
  return GRAMMAR_BY_EXT[ext] ?? null;
}

function getParser(): Promise<Parser> {
  parser ??= Parser.init().then(() => new Parser());
  return parser;
}

function getLanguage(grammar: string): Promise<Language> {
  let lang = languages.get(grammar);
  if (!lang) {
    lang = Language.load(`${GRAMMAR_DIR}tree-sitter-${grammar}.wasm`);
    languages.set(grammar, lang);
  }
  return lang;
}

/** Parse `content` and hand the tree to `use`; the tree is freed afterwards because WASM memory is
 *  not garbage collected. Null when the file type is unsupported, the file is too big, or parsing
 *  fails — callers fall back to their regex path. */
export async function withTree<T>(
  content: string,
  filePath: string,
  use: (tree: Tree) => T,
): Promise<T | null> {
  const grammar = grammarFor(filePath);
  if (!grammar || content.length > MAX_PARSE_BYTES) return null;
  try {
    // Language.load needs the runtime initialised, so the two cannot run concurrently.
    const p = await getParser();
    const lang = await getLanguage(grammar);
    // No await between setLanguage and parse, so concurrent callers cannot swap the language
    // out from under each other.
    p.setLanguage(lang);
    const tree = p.parse(content);
    if (!tree) return null;
    try { return use(tree); } finally { tree.delete(); }
  } catch {
    return null;
  }
}
