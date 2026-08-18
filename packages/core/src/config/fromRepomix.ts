import fs from 'fs';
import path from 'path';
import type { RepoCodeConfig, OutputFormat } from '../types.js';

/**
 * Translate a `repomix.config.json` into RepoCode configuration.
 *
 * The point is that trying RepoCode should cost nothing if you already use Repomix. Anything
 * that cannot be translated is reported rather than dropped: a migration that silently
 * discards half a config is worse than one that tells you what it left behind.
 */

export interface RepomixConfig {
  output?: {
    filePath?: string;
    style?: string;
    headerText?: string;
    showLineNumbers?: boolean;
    compress?: boolean;
    removeComments?: boolean;
    removeEmptyLines?: boolean;
    topFilesLength?: number;
    instructionFilePath?: string;
    fileSummary?: boolean;
    directoryStructure?: boolean;
  };
  include?: string[];
  ignore?: {
    useGitignore?: boolean;
    useDefaultPatterns?: boolean;
    customPatterns?: string[];
  };
  security?: { enableSecurityCheck?: boolean };
  tokenCount?: { encoding?: string };
}

export interface TranslationResult {
  config: Partial<RepoCodeConfig>;
  /** Human-readable notes: approximations made, and settings with no equivalent. */
  notes: string[];
}

const STYLE_TO_FORMAT: Record<string, OutputFormat> = {
  xml: 'xml',
  markdown: 'markdown',
  plain: 'plain',
};

export function translateRepomixConfig(repomix: RepomixConfig): TranslationResult {
  const notes: string[] = [];
  const config: Partial<RepoCodeConfig> = {};

  const out = repomix.output;
  if (out) {
    const output: Record<string, unknown> = {};
    if (out.filePath !== undefined) output.filePath = out.filePath;
    if (out.headerText !== undefined) output.headerText = out.headerText;
    if (out.showLineNumbers !== undefined) output.showLineNumbers = out.showLineNumbers;

    if (out.style !== undefined) {
      const format = STYLE_TO_FORMAT[out.style];
      if (format) output.format = format;
      else notes.push(`output.style "${out.style}" has no RepoCode equivalent; format left at the default.`);
    }
    if (Object.keys(output).length > 0) config.output = output as RepoCodeConfig['output'];

    if (out.compress) {
      // Repomix's --compress extracts signatures with Tree-sitter. tier2-structural strips
      // function bodies and keeps signatures — the same intent, not byte-identical output.
      config.compress = 'tier2-structural';
      notes.push('output.compress -> compress: "tier2-structural" (closest equivalent; Repomix uses Tree-sitter signature extraction).');
    }

    if (out.removeComments) notes.push('output.removeComments has no direct equivalent — comment stripping happens as part of compression tiers, not on its own.');
    if (out.removeEmptyLines) notes.push('output.removeEmptyLines has no equivalent and was not translated.');
    if (out.topFilesLength !== undefined) notes.push('output.topFilesLength has no equivalent — RepoCode selects by token budget, not by file count. Consider --max-candidates.');
    if (out.instructionFilePath) notes.push(`output.instructionFilePath -> use --instruction-file ${out.instructionFilePath}.`);
    if (out.fileSummary === false) notes.push('output.fileSummary:false -> use --no-preamble.');
  }

  if (repomix.include !== undefined) config.include = repomix.include;

  if (repomix.ignore) {
    const ig = repomix.ignore;
    // Partial on purpose: only the keys Repomix actually set are emitted, so loadConfig's
    // merge leaves the rest at RepoCode's defaults rather than overwriting them with blanks.
    const ignore: Partial<RepoCodeConfig['ignore']> = {};
    if (ig.useGitignore !== undefined) ignore.useGitignore = ig.useGitignore;
    if (ig.useDefaultPatterns !== undefined) ignore.useDefaultPatterns = ig.useDefaultPatterns;
    if (ig.customPatterns !== undefined) ignore.customPatterns = ig.customPatterns;
    if (Object.keys(ignore).length > 0) config.ignore = ignore as RepoCodeConfig['ignore'];
  }

  if (repomix.security?.enableSecurityCheck !== undefined) {
    config.security = { enabled: repomix.security.enableSecurityCheck, mode: 'warn' } as RepoCodeConfig['security'];
  }

  if (repomix.tokenCount?.encoding) {
    notes.push(`tokenCount.encoding "${repomix.tokenCount.encoding}" was not translated — RepoCode counts with tiktoken cl100k_base.`);
  }

  return { config, notes };
}

/** Read and translate `repomix.config.json` from `root`, if one exists. */
export function loadRepomixConfig(root: string): TranslationResult | null {
  const file = path.join(root, 'repomix.config.json');
  if (!fs.existsSync(file)) return null;
  try {
    return translateRepomixConfig(JSON.parse(fs.readFileSync(file, 'utf-8')) as RepomixConfig);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { config: {}, notes: [`repomix.config.json could not be parsed (${message}); nothing was translated.`] };
  }
}

/** Patterns from `.repomixignore`, which uses gitignore syntax. */
export function loadRepomixIgnore(root: string): string[] {
  try {
    return fs.readFileSync(path.join(root, '.repomixignore'), 'utf-8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));
  } catch {
    return [];
  }
}
