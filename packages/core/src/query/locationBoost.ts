import { tokenize } from './tokenizer.js';

export function locationBoost(
  content: string,
  filePath: string,
  queryTerms: string[],
  boosts: { boostFilename: number; boostExports: number; boostImports: number; boostComments: number },
): number {
  if (queryTerms.length === 0) return 0;
  const lines = content.split('\n');
  let score = 0;

  const pathTokens = tokenize(filePath);
  const filenameHit = queryTerms.some(t => pathTokens.includes(t));
  if (filenameHit) score += boosts.boostFilename;

  for (const line of lines) {
    const l = line.trim();
    const lineTerms = tokenize(l);
    const hit = queryTerms.some(t => lineTerms.includes(t));
    if (!hit) continue;
    if (/^export\s/.test(l)) { score += boosts.boostExports; continue; }
    if (/^import\s/.test(l)) { score += boosts.boostImports; continue; }
    if (l.startsWith('//') || l.startsWith('*') || l.startsWith('/*')) score += boosts.boostComments;
  }

  return score;
}
