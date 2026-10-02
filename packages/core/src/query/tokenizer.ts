/** English filler plus keywords common to most languages. Any of these would match nearly every
 *  file, so as query terms they only add noise — "as" and "self" alone matched every Python
 *  file in the benchmark repos. */
const STOP_WORDS = new Set([
  // English
  'the', 'an', 'and', 'or', 'in', 'is', 'to', 'of', 'for', 'with', 'on', 'at', 'by', 'be', 'it',
  'this', 'that', 'these', 'those', 'are', 'was', 'were', 'been', 'being', 'has', 'have', 'had',
  'do', 'does', 'did', 'not', 'no', 'but', 'if', 'then', 'else', 'when', 'where', 'which', 'who',
  'what', 'why', 'how', 'can', 'could', 'should', 'would', 'will', 'may', 'might', 'must', 'shall',
  'from', 'into', 'as', 'so', 'than', 'too', 'very', 'just', 'also', 'only', 'all', 'any', 'some',
  'there', 'here', 'we', 'you', 'he', 'she', 'they', 'them', 'its', 'our', 'your', 'my', 'me',
  'up', 'out', 'about', 'after', 'before', 'while', 'use', 'used', 'using',
  // Keywords
  'def', 'class', 'self', 'return', 'import', 'none', 'true', 'false', 'null', 'function', 'const',
  'let', 'var', 'new', 'public', 'private', 'static', 'void', 'int', 'str',
]);

/** Lowercased search terms. Identifiers are kept whole and also split on case and underscores,
 *  so a query for "upload permissions" matches FILE_UPLOAD_PERMISSIONS and fileUploadPermissions. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.match(/[A-Za-z0-9_]+/g) ?? []) {
    const whole = raw.toLowerCase();
    push(out, whole);
    // Most tokens are plain words; skip the splitting regexes for them.
    if (whole === raw && !raw.includes('_')) continue;
    const parts = raw
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[\s_]+/);
    if (parts.length > 1) for (const p of parts) push(out, p.toLowerCase());
  }
  return out;
}

function push(out: string[], t: string): void {
  if (t.length > 1 && !STOP_WORDS.has(t) && !/^\d+$/.test(t)) out.push(t.includes('_') ? t : stem(t));
}

/** Light suffix stripping so an issue's wording meets the code's: "rewriting" finds
 *  rewrite.py, "evaluation" finds evaluate.py. Deliberately smaller than Porter — only
 *  inflections that change nothing about which code a word points at. Identifiers containing
 *  an underscore are left whole so they still match exactly. */
export function stem(t: string): string {
  if (t.length <= 4) return t;
  let s = t;
  if (s.endsWith('ies')) s = s.slice(0, -3) + 'y';
  else if (s.endsWith('sses')) s = s.slice(0, -2);
  else {
    const m = /(ions|ion|ings|ing|ed)$/.exec(s);
    if (m && s.length - m[0].length >= 3) {
      s = s.slice(0, -m[0].length);
      // skipping → skipp → skip; but keep "ll", "ss", "zz" (install, pass, buzz).
      if (/([^aeiouylsz])\1$/.test(s)) s = s.slice(0, -1);
    } else if (s.endsWith('s') && !/(ss|us|is)$/.test(s)) {
      s = s.slice(0, -1);
    }
  }
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}
