import path from 'path';

const STRUCTURAL_TIER1 = new Set(['index', 'main', 'app', 'server', 'readme', 'license', 'changelog']);
const STRUCTURAL_TIER2 = new Set(['cli', 'router', 'handler', 'controller', 'middleware']);
const STRUCTURAL_TIER3 = new Set(['config', 'types', 'constants', 'schema', 'models']);

export function structuralScore(filePath: string): number {
  const base = path.basename(filePath, path.extname(filePath)).toLowerCase();
  if (STRUCTURAL_TIER1.has(base)) return 1.0;
  if (STRUCTURAL_TIER2.has(base)) return 0.75;
  if (STRUCTURAL_TIER3.has(base)) return 0.5;
  return 0.1;
}

export function depthScore(filePath: string): number {
  const depth = filePath.split('/').length - 1;
  return Math.exp(-depth * 0.3);
}

/** Scaled by log rather than by bytes. File sizes in a repo span orders of magnitude and the
 *  maximum is usually a vendored blob or data table, so a linear scale puts every ordinary
 *  source file within a few thousandths of 1.0 — the signal keeps its weight but stops
 *  discriminating. Endpoints are unchanged: an empty file scores 1.0 and the largest 0.0. */
export function sizeScore(fileSize: number, maxFileSize: number): number {
  if (maxFileSize === 0) return 1.0;
  return 1 - Math.log1p(fileSize) / Math.log1p(maxFileSize);
}

const EXT_TIER1 = new Set(['.ts', '.py', '.go', '.rs', '.java', '.kt', '.swift', '.cpp', '.c']);
const EXT_TIER2 = new Set(['.js', '.jsx', '.tsx', '.cs', '.rb', '.php']);
const EXT_TIER3 = new Set(['.json', '.yaml', '.yml', '.toml', '.sql', '.env']);
const EXT_TIER4 = new Set(['.md', '.txt', '.rst', '.html', '.css', '.scss']);

export function extensionScore(filePath: string): number {
  const ext = path.extname(filePath).toLowerCase();
  if (EXT_TIER1.has(ext)) return 1.0;
  if (EXT_TIER2.has(ext)) return 0.9;
  if (EXT_TIER3.has(ext)) return 0.5;
  if (EXT_TIER4.has(ext)) return 0.2;
  return 0.1;
}

export function keywordScore(filePath: string, keywords: string[]): number {
  const lower = filePath.toLowerCase();
  const matched = keywords.filter(kw => lower.includes(kw)).length;
  if (matched === 0) return 0;
  return Math.min(1.0, matched * 0.5);
}

/** `now` is a parameter so a whole ranking pass can share one reading. Reading the clock
 *  per file makes later-scored files look fractionally older, which leaks input order
 *  into the ranking. */
export function recencyScore(mtime: Date, now: number = Date.now()): number {
  const ageMs = now - mtime.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.exp(-ageDays / 7);
}
