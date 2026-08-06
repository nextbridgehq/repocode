import type { HunkRange } from '../types.js';

/** Lines kept verbatim from the top of a file during partial extraction. */
const DEFAULT_TOP_LINES = 50;

/** Lines of context shown around each changed hunk during hunk-window extraction. */
const DEFAULT_HUNK_WINDOW_LINES = 30;

const SIGNATURE_PATTERNS: Partial<Record<string, RegExp>> = {
  typescript: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*[\w$]+|(?:class)\s+[\w$]+|(?:(?:public|private|protected|static|override|abstract)\s+)+(?:async\s+)?(?:[\w$]+\s*(?:<[^>]*>)?\s*\())/,
  javascript: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*[\w$]+|class\s+[\w$]+|(?:(?:public|private|protected|static|override|abstract)\s+)+(?:async\s+)?(?:[\w$]+\s*\())/,
  python: /^\s*(?:async\s+)?def\s+\w/,
  go: /^\s*func\s+/,
};

const OMIT = (n: number): string => `// ... [${n} lines omitted] ...`;

function getSigPattern(language: string | null): RegExp {
  const lang = language?.toLowerCase() ?? '';
  return SIGNATURE_PATTERNS[lang] ?? SIGNATURE_PATTERNS.typescript!;
}

export function extractTopAndSignatures(
  content: string,
  language: string | null,
  topLines = DEFAULT_TOP_LINES,
): string {
  const lines = content.split('\n');

  if (lines.length <= topLines) return content;

  const sigPattern = getSigPattern(language);
  const top = lines.slice(0, topLines);
  const rest = lines.slice(topLines);

  const signatures: string[] = [];
  for (const line of rest) {
    if (sigPattern.test(line)) signatures.push(line);
  }

  const omitted = rest.length - signatures.length;
  const parts = [...top];
  if (signatures.length > 0) {
    parts.push(OMIT(omitted));
    parts.push(...signatures);
  } else {
    parts.push(OMIT(rest.length));
  }

  return parts.join('\n');
}

export function extractHunkWindow(
  content: string,
  language: string | null,
  hunks: HunkRange[],
  windowLines = DEFAULT_HUNK_WINDOW_LINES,
): string {
  const lines = content.split('\n');
  const totalLines = lines.length;
  const sigPattern = getSigPattern(language);

  // Collect all function/class signatures from the whole file
  const signatures: string[] = [];
  for (const line of lines) {
    if (sigPattern.test(line)) signatures.push(line);
  }

  // Build windows (0-indexed internally), clamped to file bounds
  const rawWindows = hunks.map(h => ({
    start: Math.max(0, h.start - 1 - windowLines),
    end: Math.min(totalLines - 1, h.end - 1 + windowLines),
  }));

  // Sort and merge overlapping windows
  rawWindows.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const w of rawWindows) {
    if (merged.length > 0 && w.start <= merged[merged.length - 1].end + 1) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, w.end);
    } else {
      merged.push({ ...w });
    }
  }

  // Build output: signatures block + omission banners + hunk windows
  const parts: string[] = [...signatures];
  if (signatures.length > 0) parts.push('');

  let cursor = 0;
  for (const w of merged) {
    if (w.start > cursor) parts.push(OMIT(w.start - cursor));
    parts.push(...lines.slice(w.start, w.end + 1));
    cursor = w.end + 1;
  }
  if (cursor < totalLines) parts.push(OMIT(totalLines - cursor));

  return parts.join('\n');
}

export function extractPartial(
  content: string,
  language: string | null,
  hunks?: HunkRange[],
): string {
  if (hunks && hunks.length > 0) {
    return extractHunkWindow(content, language, hunks);
  }
  return extractTopAndSignatures(content, language);
}
