const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'in', 'is', 'to', 'of', 'for', 'with']);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}
