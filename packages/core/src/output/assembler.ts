import path from 'path';
import fs from 'fs';
import type { BudgetFile, OutputFormat, CompressionLevel, SignalScores } from '../types.js';
import { formatXml } from './formatters/xml.js';
import { formatMarkdown } from './formatters/markdown.js';
import { formatPlain } from './formatters/plain.js';
import { formatJson } from './formatters/json.js';

export interface AssembledFile {
  path: string;
  language: string | null;
  tokens: number;
  rank: number;
  content: string;
  compressed: boolean;
  compressionLevel?: CompressionLevel;
  deleted?: boolean;
  score?: number;          // present when includeScores is true
  signals?: SignalScores;  // present when includeScores is true
}

export interface AssembledContext {
  preamble: string;
  header: {
    generated: string;
    repository: string;
    tokens: number;
    budget: number | null;
    fileCount: number;
  };
  instructions: string;
  tree: string;
  includeScores: boolean;  // whether score/signals are populated on each file
  files: AssembledFile[];
}

export interface AssembleOptions {
  root: string;
  headerText: string;
  preamble: boolean;
  instructionFile: string | null;
  instructionText?: string;  // pre-resolved instruction text from library
  budget: number | null;
  includeScores?: boolean;  // whether to populate score/signals on each assembled file
}

function inferLanguage(files: BudgetFile[]): string {
  const counts = new Map<string, number>();
  for (const f of files) {
    if (f.language) counts.set(f.language, (counts.get(f.language) ?? 0) + 1);
  }
  let best = 'unknown';
  let max = 0;
  for (const [lang, count] of counts) {
    if (count > max) { max = count; best = lang; }
  }
  return best;
}

export function assemble(
  included: BudgetFile[],
  options: AssembleOptions,
  totalTokens: number,
  tree: string,
): AssembledContext {
  const repoName = path.basename(options.root);
  const language = inferLanguage(included);

  let preambleText = '';
  if (options.preamble) {
    const budgetInfo = options.budget != null
      ? ` to fit within a ${options.budget.toLocaleString()} token budget`
      : '';
    const fileWord = included.length === 1 ? 'file' : 'files';
    preambleText =
      `This file contains source code from the repository "${repoName}" (${language}). ` +
      `It includes ${included.length} ${fileWord} selected by relevance${budgetInfo}. ` +
      `Files are ordered by importance. The directory tree shows the structure of included files.`;
  }

  let instructions = '';
  if (options.instructionText) {
    instructions = options.instructionText;
  } else if (options.instructionFile) {
    try {
      instructions = fs.readFileSync(options.instructionFile, 'utf-8');
    } catch {
      // silently omit on error
    }
  }
  if (options.headerText) {
    instructions = options.headerText + (instructions ? '\n\n' + instructions : '');
  }

  return {
    preamble: preambleText,
    header: {
      generated: new Date().toISOString(),
      repository: repoName,
      tokens: totalTokens,
      budget: options.budget,
      fileCount: included.length,
    },
    instructions,
    tree,
    includeScores: options.includeScores ?? false,
    files: included.map((f, i) => ({
      path: f.path,
      language: f.language,
      tokens: f.accurateTokens,
      rank: i + 1,
      content: f.content,
      compressed: f.compressed,
      compressionLevel: f.compressionLevel,
      deleted: f.deleted,
      ...(options.includeScores ? { score: f.score, signals: f.signalScores } : {}),
    })),
  };
}

export function formatOutput(ctx: AssembledContext, format: OutputFormat): string {
  switch (format) {
    case 'xml':      return formatXml(ctx);
    case 'markdown': return formatMarkdown(ctx);
    case 'plain':    return formatPlain(ctx);
    case 'json':     return formatJson(ctx);
  }
}
