import { loadConfig } from '@repocode/core';
import type { RepoCodeConfig, OutputFormat, SecurityMode, GitMode, GitConfig, LLMProviderName } from '@repocode/core';
import path from 'path';

export interface CLIOptions {
  budget?: string;
  format?: OutputFormat;
  output?: string;
  stdout?: boolean;
  copy?: boolean;
  include?: string[];
  exclude?: string[];
  security?: boolean | SecurityMode;
  securityMode?: SecurityMode;
  compress?: string | boolean;
  verbose?: boolean;
  dryRun?: boolean;
  explain?: boolean;
  pin?: string[];
  preamble?: boolean;
  instruction?: string;
  header?: string;
  maxFileSize?: string;
  diff?: boolean;
  staged?: boolean;
  branch?: string;
  log?: string;
  range?: string;
  pr?: boolean;
  base?: string;
  deps?: boolean;
  graphDepth?: string;
  preset?: string;
  listPresets?: boolean;
  savePreset?: string;
  query?: string;
  queryMode?: string;
  instructionFile?: string;
  instructionText?: string;
  listInstructions?: boolean;
  llmProvider?: string;
  llmModel?: string;
  llmBudgetTokens?: string;
  stdinFiles?: string[];
  outputBaseDir?: string;
}

export async function buildPackConfig(
  targetPath: string,
  opts: CLIOptions,
  optionSource: (key: string) => string | undefined = () => 'cli',
): Promise<RepoCodeConfig> {
  const root = path.resolve(targetPath ?? '.');

  // Commander maps --no-budget to opts.budget === false (boolean)
  const noBudget = opts.budget === (false as unknown as string);
  const maxTokens = noBudget
    ? null
    : opts.budget
      ? parseInt((opts.budget as string).replace(/k$/i, '000').replace(/m$/i, '000000'), 10)
      : undefined; // let config/default handle it

  const maxFileSizeBytes = opts.maxFileSize
    ? parseInt(opts.maxFileSize.replace(/k$/i, '000').replace(/m$/i, '000000'), 10)
    : undefined;

  // Git flag mutual exclusion
  const gitFlagNames = ['diff', 'staged', 'branch', 'log', 'range', 'pr'] as const;
  const activeGitFlags = gitFlagNames.filter(f => opts[f]);
  if (activeGitFlags.length > 1) {
    process.stderr.write(`[repocode] error: only one git mode flag may be used at a time (got: --${activeGitFlags.join(', --')})\n`);
    process.exit(1);
  }

  // Build GitConfig if a git flag is active
  let gitConfig: GitConfig | undefined;
  if (activeGitFlags.length === 1) {
    const mode = activeGitFlags[0] as GitMode;
    gitConfig = {
      mode,
      branch: opts.branch,
      base: opts.base,
      n: opts.log !== undefined ? parseInt(opts.log, 10) : undefined,
      range: opts.range,
      deps: opts.deps !== false,
    };
    if (mode === 'log' && (gitConfig.n === undefined || isNaN(gitConfig.n) || gitConfig.n < 1)) {
      process.stderr.write('[repocode] error: --log requires a positive integer argument (e.g. --log 3)\n');
      process.exit(1);
    }
    if (mode === 'branch' && !opts.branch) {
      process.stderr.write('[repocode] error: --branch requires a branch name argument (e.g. --branch feature/my-branch)\n');
      process.exit(1);
    }
    if (mode === 'range' && !opts.range) {
      process.stderr.write('[repocode] error: --range requires a range argument (e.g. --range HEAD~3..HEAD)\n');
      process.exit(1);
    }
  }

  // securityMode carries a Commander-level default ('warn'), so opts.securityMode is never
  // undefined — optionSource distinguishes "user typed --security-mode" from "Commander default applied".
  const securityModeExplicit = optionSource('securityMode') === 'cli';
  // preamble is a solo --no-preamble negation (no positive counterpart), so Commander defaults
  // opts.preamble to true — optionSource distinguishes "user typed --no-preamble" from unset.
  const preambleExplicit = optionSource('preamble') === 'cli';

  const overrides: Partial<RepoCodeConfig> = {
    output: {
      format: opts.format,
      filePath: opts.output ?? null,
      stdout: opts.stdout,
      copy: opts.copy,
      preamble: preambleExplicit ? opts.preamble : undefined,
      instructionFile: opts.instructionFile ?? null,
      headerText: opts.header ?? '',
      includeScores: opts.explain,
    },
    budget: maxTokens !== undefined ? { maxTokens } : undefined,
    ...(opts.include !== undefined ? { include: opts.include } : {}),
    ...(opts.exclude !== undefined ? { exclude: opts.exclude } : {}),
    security: opts.security === (false as unknown as SecurityMode)
      ? { enabled: false, mode: 'warn' }
      : securityModeExplicit && opts.securityMode
        ? { enabled: true, mode: opts.securityMode }
        : undefined,
    compress: (() => {
      if (opts.compress === false || opts.compress === 'none') return 'none';
      if (opts.compress === 'tier1') return 'tier1-regex';
      if (opts.compress === 'tier2') return 'tier2-structural';
      if (opts.compress === 'tier3-llm') return 'tier3-llm';
      if (opts.compress === 'partial') return 'partial';
      return undefined; // use config/default
    })(),
    verbose: opts.verbose,
    dryRun: opts.dryRun ?? opts.explain,
    ranking: opts.pin ? { pinned: opts.pin } : undefined,
    ...(maxFileSizeBytes !== undefined ? { maxFileSizeBytes } : {}),
    ...(opts.graphDepth !== undefined ? { graphDepth: parseInt(opts.graphDepth, 10) } : {}),
    git: gitConfig,
    stdinFiles: opts.stdinFiles,
  } as Partial<RepoCodeConfig>;

  // Query
  if (opts.query !== undefined) (overrides as Record<string, unknown>)['query'] = opts.query;
  if (opts.queryMode !== undefined) {
    (overrides as Record<string, unknown>)['queryConfig'] = {
      ...((overrides as Record<string, unknown>)['queryConfig'] as object ?? {}),
      mode: opts.queryMode,
    };
  }

  // Instruction (precedence: instructionFile > instruction name > instructionText)
  if (opts.instructionFile) {
    (overrides as Record<string, unknown>)['instruction'] = { file: opts.instructionFile };
  } else if (opts.instruction && !opts.instruction.includes('/') && !opts.instruction.includes('\\') && !opts.instruction.endsWith('.md') && !opts.instruction.endsWith('.txt')) {
    (overrides as Record<string, unknown>)['instruction'] = { name: opts.instruction };
  } else if (opts.instructionText) {
    (overrides as Record<string, unknown>)['instruction'] = { text: opts.instructionText };
  }

  // LLM
  if (opts.llmProvider || opts.llmModel || opts.llmBudgetTokens) {
    (overrides as Record<string, unknown>)['llm'] = {
      ...(opts.llmProvider ? { provider: opts.llmProvider as LLMProviderName } : {}),
      ...(opts.llmModel ? { model: opts.llmModel } : {}),
      ...(opts.llmBudgetTokens ? { budgetTokens: parseInt(opts.llmBudgetTokens, 10) } : {}),
    };
  }

  return loadConfig(root, { ...overrides, root }, { preset: opts.preset, allowJsConfig: true });
}

export function buildPresetData(opts: CLIOptions): Partial<RepoCodeConfig> {
  const data: Record<string, unknown> = {};

  if (opts.include !== undefined) data['include'] = opts.include;
  if (opts.exclude !== undefined) data['exclude'] = opts.exclude;
  if (opts.compress !== undefined && opts.compress !== (false as unknown as string)) {
    const level = opts.compress === 'tier1' ? 'tier1-regex'
      : opts.compress === 'tier2' ? 'tier2-structural'
      : opts.compress === 'tier3-llm' ? 'tier3-llm'
      : opts.compress === 'none' || opts.compress === false ? 'none'
      : opts.compress;
    data['compress'] = level;
  }
  if (opts.budget !== undefined && opts.budget !== (false as unknown as string)) {
    const tokens = parseInt((opts.budget as string).replace(/k$/i, '000').replace(/m$/i, '000000'), 10);
    if (!isNaN(tokens)) data['budget'] = { maxTokens: tokens };
  }
  if (opts.graphDepth !== undefined) data['graphDepth'] = parseInt(opts.graphDepth, 10);
  if (opts.pin !== undefined) data['ranking'] = { pinned: opts.pin };
  if (opts.format !== undefined) data['output'] = { format: opts.format };

  return data as Partial<RepoCodeConfig>;
}
