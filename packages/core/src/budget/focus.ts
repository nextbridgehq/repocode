import { extractSymbols, type CodeSymbol } from '../parse/symbols.js';
import { tokenize } from '../query/tokenizer.js';
import { buildBM25, scoreBM25 } from '../query/bm25.js';

/** How many symbol bodies each step of the ladder keeps. */
export const FOCUS_BODY_COUNTS = [1, 3, 8];

/** Weight of a title term (first line of a multi-line query) against a body term; same as `rerank`. */
const TITLE_WEIGHT = 5;

/** Added to a symbol whose name the query spells out; larger than any BM25 sum, so a named symbol leads. */
const NAME_BOOST = 1000;
const MIN_NAME_LENGTH = 4;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A symbol worth showing in full: a function or method, or a class/interface with no members of its
 *  own to show instead. A class that has members stays in the skeleton as its header and attributes. */
function candidatesOf(symbols: CodeSymbol[]): CodeSymbol[] {
  return symbols.filter(s => {
    if (s.kind === 'function' || s.kind === 'method') return true;
    return !symbols.some(m => m !== s && m.parent === s.name && m.startLine >= s.startLine && m.endLine <= s.endLine);
  });
}

function rankSymbols(candidates: CodeSymbol[], lines: string[], query: string): CodeSymbol[] {
  const terms = [...new Set(tokenize(query))];
  const weight = new Map<string, number>();
  const queryLines = query.split(/\r?\n/).filter(l => l.trim());
  if (queryLines.length > 1) for (const t of tokenize(queryLines[0])) weight.set(t, TITLE_WEIGHT);

  const index = buildBM25(candidates.map((s, i) => ({
    path: String(i),
    text: lines.slice(s.startLine - 1, s.endLine).join('\n'),
  })));
  return candidates
    .map((s, i) => {
      const named = s.name.length >= MIN_NAME_LENGTH
        && new RegExp(`(?<![\\w])${escape(s.name)}(?![\\w])`).test(query);
      return { s, score: scoreBM25(terms, index, String(i), weight) + (named ? NAME_BOOST : 0) };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.startLine - b.s.startLine)
    .map(x => x.s);
}

/** The file with every candidate's body replaced by one marker line, except the `keep` symbols. */
function render(lines: string[], candidates: CodeSymbol[], keep: Set<CodeSymbol>, braces: boolean): string {
  const comment = braces ? '//' : '#';
  const omitted = new Map<number, { from: number; to: number }>(); // first omitted line -> range
  const skip = new Set<number>();
  for (const s of candidates) {
    if (keep.has(s)) continue;
    const from = s.bodyStartLine;
    const to = braces ? s.endLine - 1 : s.endLine;
    if (from <= s.startLine || to < from) continue; // body shares the signature's line, or is empty
    omitted.set(from, { from, to });
    for (let l = from; l <= to; l++) skip.add(l);
  }
  const out: string[] = [];
  for (let l = 1; l <= lines.length; l++) {
    const range = omitted.get(l);
    if (range) {
      const indent = /^\s*/.exec(lines[l - 1])![0];
      out.push(`${indent}${comment} ... [${range.to - range.from + 1} lines omitted: L${range.from}-L${range.to}] ...`);
    } else if (!skip.has(l)) {
      out.push(lines[l - 1]);
    }
  }
  return out.join('\n');
}

/**
 * Representations of `content` that keep the bodies of the symbols a query is about and only the
 * signatures of the rest — a file too big to include whole can still deliver the part the task
 * needs. One variant per entry of `counts` (that many bodies), smallest first, identical variants
 * collapsed. Null when the file type has no grammar or no symbol matches the query.
 */
export async function buildFocus(
  content: string,
  filePath: string,
  query: string,
  counts: number[] = FOCUS_BODY_COUNTS,
): Promise<string[] | null> {
  const symbols = await extractSymbols(content, filePath);
  if (!symbols || symbols.length === 0) return null;

  const lines = content.split('\n');
  const candidates = candidatesOf(symbols);
  const ranked = rankSymbols(candidates, lines, query);
  if (ranked.length === 0) return null;

  const braces = !filePath.toLowerCase().endsWith('.py');
  const variants: string[] = [];
  for (const n of counts) {
    const text = render(lines, candidates, new Set(ranked.slice(0, n)), braces);
    if (!variants.includes(text)) variants.push(text);
  }
  return variants;
}
