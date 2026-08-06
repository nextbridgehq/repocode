const SINGLE_LINE_COMMENT: Record<string, RegExp> = {
  typescript: /\/\/[^\n]*/g,
  javascript: /\/\/[^\n]*/g,
  go: /\/\/[^\n]*/g,
  rust: /\/\/[^\n]*/g,
  java: /\/\/[^\n]*/g,
  python: /#[^\n]*/g,
  ruby: /#[^\n]*/g,
};

const BLOCK_COMMENT: Record<string, RegExp> = {
  typescript: /\/\*[\s\S]*?\*\//g,
  javascript: /\/\*[\s\S]*?\*\//g,
  go: /\/\*[\s\S]*?\*\//g,
  rust: /\/\*[\s\S]*?\*\//g,
  java: /\/\*[\s\S]*?\*\//g,
};

const PYTHON_DOCSTRING = /"""[\s\S]*?"""|'''[\s\S]*?'''/g;

export function compressTier1(content: string, language: string | null): string {
  let result = content;
  const lang = language?.toLowerCase() ?? '';

  // Strip block comments first (before single-line, to avoid partial matches)
  if (BLOCK_COMMENT[lang]) {
    result = result.replace(BLOCK_COMMENT[lang], '');
  }
  if (lang === 'python') {
    result = result.replace(PYTHON_DOCSTRING, '');
  }

  // Strip single-line comments (preserve the newline)
  if (SINGLE_LINE_COMMENT[lang]) {
    result = result.replace(SINGLE_LINE_COMMENT[lang], '');
  }

  // Collapse 3+ consecutive blank lines to 2
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}

// ─── Tier 2: structural compression (strip function/method bodies) ──────────

type ScanState =
  | 'code' | 'line-comment' | 'block-comment'
  | 'string-single' | 'string-double' | 'template'
  | 'regex' | 'regex-class';

/** Keywords after which a '/' begins a regex literal rather than division. */
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'case', 'do', 'else', 'yield', 'await',
]);

/** Punctuation after which a '/' begins a regex literal rather than division.
 *  Everything not listed here — notably ')' and ']', plus identifiers, numbers
 *  and string terminators — is treated as division. */
const REGEX_PRECEDING_PUNCT = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';',
  '+', '-', '*', '%', '<', '>', '~', '^',
]);

const IDENT_CHAR = /[A-Za-z0-9_$]/;

/** Decide whether a '/' at the current position opens a regex literal, based on
 *  the previous significant token. `prevToken` is '' at start of input (regex
 *  allowed), a single punctuation character, or an identifier/number/keyword. */
function opensRegexLiteral(prevToken: string): boolean {
  if (prevToken === '') return true;
  if (prevToken.length === 1 && REGEX_PRECEDING_PUNCT.has(prevToken)) return true;
  return REGEX_PRECEDING_KEYWORDS.has(prevToken);
}

/** @param allowRegex whether the language has regex literals. Go does not — its
 *  '/' is always division — so enabling regex scanning there would misread
 *  ordinary arithmetic as a literal. */
function findMatchingClose(content: string, openAt: number, allowRegex: boolean): number {
  let depth = 0;
  let state: ScanState = 'code';
  // Depth value recorded just before each unclosed '${' was entered — used to
  // detect exactly which '}' resumes template scanning (supports multiple
  // and/or nested interpolations within the same template literal).
  const templateBaseDepths: number[] = [];
  // Previous significant token in code state, used only for the regex-vs-division
  // decision. Identifier characters accumulate in `wordBuf` until a delimiter.
  let prevToken = '';
  let wordBuf = '';

  for (let i = openAt; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (state === 'regex') {
      if (ch === '\\') { i++; continue; }
      if (ch === '[') { state = 'regex-class'; continue; }
      // A regex literal cannot span a newline. If we reach one we misjudged the
      // '/' — reset to code so a wrong guess costs at most the rest of the line
      // rather than swallowing the remainder of the file.
      if (ch === '\n') { state = 'code'; prevToken = ''; continue; }
      if (ch === '/') {
        state = 'code';
        // A completed regex literal is a value, so a following '/' is division.
        prevToken = 'x';
        continue;
      }
      continue;
    }
    if (state === 'regex-class') {
      if (ch === '\\') { i++; continue; }
      if (ch === '\n') { state = 'code'; prevToken = ''; continue; }
      if (ch === ']') { state = 'regex'; continue; }
      continue;
    }

    if (state === 'line-comment') {
      if (ch === '\n') state = 'code';
      continue;
    }
    if (state === 'block-comment') {
      if (ch === '*' && next === '/') { state = 'code'; i++; }
      continue;
    }
    if (state === 'string-single') {
      if (ch === '\\') { i++; continue; }
      // A completed string is a value, so a following '/' is division.
      if (ch === "'") { state = 'code'; prevToken = 'x'; }
      continue;
    }
    if (state === 'string-double') {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') { state = 'code'; prevToken = 'x'; }
      continue;
    }
    if (state === 'template') {
      // No backslash-escape handling here (unlike the quoted-string states below):
      // Go raw strings are also backtick-delimited and treat '\' as a literal
      // character, not an escape introducer, so a raw string ending in '\' must
      // still end its state at the very next backtick. Tradeoff: a JS/TS template
      // literal containing a deliberately-escaped backtick (`` `a\`b` ``) will now
      // end one character early at that escaped backtick — accepted as rare in
      // practice versus Go raw strings ending in '\' (e.g. Windows paths), which
      // are a realistic case this function must support correctly.
      if (ch === '`') { state = 'code'; prevToken = 'x'; continue; }
      if (ch === '$' && next === '{') {
        templateBaseDepths.push(depth);
        depth++; // the '{' of ${...} counts toward brace depth like any other
        state = 'code';
        prevToken = '{';
        i++;
        continue;
      }
      continue;
    }

    // state === 'code'
    // Track the previous significant token for the regex-vs-division decision.
    if (IDENT_CHAR.test(ch)) { wordBuf += ch; continue; }
    if (wordBuf) { prevToken = wordBuf; wordBuf = ''; }

    if (ch === '/' && next === '/') { state = 'line-comment'; i++; continue; }
    if (ch === '/' && next === '*') { state = 'block-comment'; i++; continue; }
    if (ch === '/' && allowRegex && opensRegexLiteral(prevToken)) { state = 'regex'; continue; }
    if (ch === "'") { state = 'string-single'; continue; }
    if (ch === '"') { state = 'string-double'; continue; }
    if (ch === '`') { state = 'template'; continue; }
    if (!/\s/.test(ch)) prevToken = ch;
    if (ch === '{') {
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (templateBaseDepths.length > 0 && depth === templateBaseDepths[templateBaseDepths.length - 1]) {
        // closing a ${...} interpolation — resume template scanning, not code
        templateBaseDepths.pop();
        state = 'template';
        continue;
      }
      if (depth === 0) return i;
      continue;
    }
  }
  return -1; // malformed input
}

// Returns the text from the last statement boundary to `pos`.
// Used to determine what kind of '{' we're looking at.
function getContextBefore(content: string, pos: number): string {
  let i = pos - 1;
  while (i >= 0) {
    const ch = content[i];
    // Hard breaks: previous statement end
    if (ch === '}' || ch === ';') break;
    if (ch === '\n') {
      // If previous non-empty line ends with a continuation character, keep walking
      let lineEnd = i - 1;
      while (lineEnd >= 0 && content[lineEnd] === '\r') lineEnd--;
      let lineStart = lineEnd;
      while (lineStart > 0 && content[lineStart - 1] !== '\n') lineStart--;
      const prevLine = content.slice(lineStart, lineEnd + 1).trimEnd();
      const CONTINUATION = /[,(|&=]$/.test(prevLine) || prevLine.endsWith('=>');
      if (!CONTINUATION) break;
    }
    i--;
  }
  return content.slice(i + 1, pos);
}

function isFunctionBody(context: string): boolean {
  const t = context.trim();
  if (!t) return false;

  // Last line of multi-line context (handles multiline signatures)
  const lastLine = t.split('\n').pop()?.trimEnd() ?? '';

  // Control flow blocks — not function bodies
  if (/^\s*(else|try|finally|do)\s*$/.test(lastLine)) return false;
  if (/\b(if|for|while|switch|catch)\s*\(/.test(lastLine)) return false;

  // Class declaration (no params on the same line as 'class') — not a function body
  // Class methods DO have '(' and are caught below
  if (/\bclass\b/.test(t) && !/\bclass\b[^{]*\(/.test(t)) return false;

  // Arrow function: context ends with =>
  if (/=>\s*$/.test(t)) return true;

  // Function or method: context ends with ) or ): ReturnType or space + type (Go)
  // Handles: ): ReturnType, ) ReturnType, generics like Promise<string>, arrays [], unions |, intersections &
  if (/\)\s*(:\s*[\w<>\[\]|&.,\s?*()\{\}!]+)?\s*$/.test(t)) return true;
  // Go style: ) followed by type name (no colon), e.g., ") string" or ") error"
  if (/\)\s+[\w<>\[\]]+\s*$/.test(t)) return true;

  return false;
}

function stripBraceBodies(content: string, allowRegex: boolean): string {
  let result = '';
  let i = 0;
  while (i < content.length) {
    if (content[i] !== '{') {
      result += content[i++];
      continue;
    }
    const context = getContextBefore(content, i);
    if (isFunctionBody(context)) {
      const closeAt = findMatchingClose(content, i, allowRegex);
      if (closeAt === -1) {
        // The scanner couldn't find a properly matching close brace for this
        // body (unbalanced or otherwise unparseable input). Rather than emit a
        // placeholder while leaving the real body un-consumed (which would
        // duplicate content), leave this '{' as ordinary text and fall back to
        // "don't compress this body".
        result += content[i++];
      } else {
        result += '{ /* ... */ }';
        i = closeAt + 1;
      }
    } else {
      result += content[i++];
    }
  }
  return result;
}

function stripPythonBodies(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const defMatch = line.match(/^(\s*)(?:async\s+)?def\s+/);

    if (!defMatch) {
      result.push(line);
      i++;
      continue;
    }

    // Add the def line
    result.push(line);
    i++;
    const defIndent = defMatch[1].length;

    // Collect continuation lines of the signature (multi-line param lists)
    // until we find a line ending with ':'
    let signatureComplete = line.trimEnd().endsWith(':');
    while (!signatureComplete && i < lines.length) {
      const l = lines[i];
      result.push(l);
      i++;
      if (l.trimEnd().endsWith(':')) signatureComplete = true;
    }

    // Replace function body with '...'
    let bodyEmitted = false;
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === '') { i++; continue; } // skip blank lines inside body
      const lineIndent = l.match(/^(\s*)/)?.[1].length ?? 0;
      if (lineIndent <= defIndent) break; // end of body (back to outer indent)
      if (!bodyEmitted) {
        result.push(' '.repeat(defIndent + 4) + '...');
        bodyEmitted = true;
      }
      i++;
    }
  }

  return result.join('\n');
}

export function compressTier2(content: string, language: string | null): string {
  const lang = language?.toLowerCase() ?? '';
  if (lang === 'python') return stripPythonBodies(content);
  // Go has no regex literals — its '/' is always division.
  if (lang === 'typescript' || lang === 'javascript') return stripBraceBodies(content, true);
  if (lang === 'go') return stripBraceBodies(content, false);
  return content;
}
