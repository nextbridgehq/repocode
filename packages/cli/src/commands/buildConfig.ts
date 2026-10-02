import { loadConfig, loadRepomixConfig, budgetForModel, knownModelNames, MODEL_TABLE_VERIFIED_ON } from '@repocode/core';
import type { RepoCodeConfig, OutputFormat, SecurityMode, GitMode, GitConfig, LLMProviderName } from '@repocode/core';
import fs from 'fs';
import path from 'path';

export interface CLIOptions {
  budget?: string;
  model?: string;
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
  maxCandidates?: string;
  stableOrder?: boolean;
  fromRepomix?: boolean;
  preset?: string;
  listPresets?: boolean;
  savePreset?: string;
  query?: string;
  queryFile?: string;
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
  const explicitBudget = !noBudget && opts.budget
    ? parseInt((opts.budget as string).replace(/k$/i, '000').replace(/m$/i, '000000'), 10)
    : undefined;

  // --model is a convenience for picking a budget, so an explicit --budget outranks it rather
  // than conflicting with it. Saying both is how you pack for a model but override the size.
  let modelBudget: number | undefined;
  if (opts.model !== undefined && !noBudget) {
    const derived = budgetForModel(opts.model);
    if (derived === null) {
      process.stderr.write(
        `[repocode] error: unknown model "${opts.model}". Known: ${knownModelNames().join(', ')}\n` +
        `[repocode] context windows verified ${MODEL_TABLE_VERIFIED_ON}; use --budget <tokens> for anything not listed.\n`,
      );
      process.exit(1);
    }
    if (explicitBudget === undefined) modelBudget = derived;
  }

  const maxTokens = noBudget
    ? null
    : explicitBudget ?? modelBudget; // undefined lets config/default handle it

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
      ...(opts.stableOrder ? { stableOrder: true } : {}),
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
    ...(opts.maxCandidates !== undefined ? { maxCandidates: parseInt(opts.maxCandidates, 10) } : {}),
    git: gitConfig,
    stdinFiles: opts.stdinFiles,
  } as Partial<RepoCodeConfig>;

  // Query
  if (opts.query !== undefined && opts.queryFile !== undefined) {
    throw new Error('--query and --query-file cannot be combined; pass the query one way');
  }
  if (opts.query !== undefined) (overrides as Record<string, unknown>)['query'] = opts.query;
  // A whole issue or stack trace is the best query there is, and too long for an argument.
  if (opts.queryFile !== undefined) {
    (overrides as Record<string, unknown>)['query'] = fs.readFileSync(path.resolve(opts.queryFile), 'utf-8');
  }
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

  // Repomix config sits below explicit CLI flags and above defaults, the same slot a project
  // config occupies — so `--from-repomix -f markdown` still honours the flag the user typed.
  let effective = overrides;
  if (opts.fromRepomix) {
    const translated = loadRepomixConfig(root);
    if (!translated) {
      process.stderr.write('[repocode] warning: --from-repomix given but no repomix.config.json found in ' + root + '\n');
    } else {
      effective = mergeUnder(translated.config, overrides);
      for (const note of translated.notes) {
        process.stderr.write(`[repocode] from-repomix: ${note}\n`);
      }
    }
  }

  return loadConfig(root, { ...effective, root }, { preset: opts.preset, allowJsConfig: true });
}

/** Merge `over` on top of `base`, one level into plain objects. Keys whose value is undefined
 *  do not overwrite — Commander leaves most options undefined, and treating those as an
 *  explicit "unset" would silently erase whatever the Repomix config had said. */
function mergeUnder(
  base: Partial<RepoCodeConfig>,
  over: Partial<RepoCodeConfig>,
): Partial<RepoCodeConfig> {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(over as Record<string, unknown>)) {
    if (value === undefined) continue;
    const existing = out[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      const merged: Record<string, unknown> = { ...existing };
      for (const [k, v] of Object.entries(value)) if (v !== undefined) merged[k] = v;
      out[key] = merged;
    } else {
      out[key] = value;
    }
  }
  return out as Partial<RepoCodeConfig>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
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
