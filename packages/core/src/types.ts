export type OutputFormat = 'xml' | 'markdown' | 'plain' | 'json';
export type SecurityMode = 'warn' | 'exclude' | 'redact' | 'fail';
export type CompressionLevel = 'none' | 'tier1-regex' | 'tier2-structural' | 'tier3-llm' | 'partial';

export interface SelectiveCompressConfig {
  top10?: CompressionLevel;
  top50?: CompressionLevel;
  rest?: CompressionLevel;
}
export type CompressConfig = CompressionLevel | SelectiveCompressConfig;

export function getCompressionTier(rankPosition: number, config: CompressConfig): CompressionLevel {
  if (typeof config === 'string') return config;
  const { top10 = 'none', top50 = 'none', rest = 'none' } = config;
  if (rankPosition <= 10) return top10;
  if (rankPosition <= 50) return top50;
  return rest;
}

export type LLMProviderName = 'openai' | 'anthropic' | 'ollama' | 'custom';

export interface LLMConfig {
  provider?: LLMProviderName;
  model?: string;
  budgetTokens?: number;
  endpoint?: string;
}

export type QueryMode = 'keyword' | 'semantic';

export interface QueryConfig {
  mode: QueryMode;
  boostFilename: number;
  boostExports: number;
  boostImports: number;
  boostComments: number;
  maxEmbedFiles: number;
}

export interface InstructionDef {
  text?: string;
  file?: string;
  description?: string;
}

export interface InstructionConfig {
  name?: string;
  file?: string;
  text?: string;
}

export interface HunkRange {
  start: number; // 1-indexed line number, inclusive
  end: number;   // 1-indexed line number, inclusive
}

export type GitMode = 'diff' | 'staged' | 'branch' | 'log' | 'range' | 'pr';

export interface GitChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
  tracked: boolean;   // false for untracked files (git ls-files --others)
  oldPath?: string;   // renames only
}

export interface TraceResult {
  importers: string[];     // files that import a changed file
  dependencies: string[];  // files that changed files import
}

export interface GitConfig {
  mode: GitMode;
  branch?: string;
  base?: string;
  n?: number;
  range?: string;
  deps: boolean;
}

export type ExclusionReason =
  | 'binary'
  | 'ignored'
  | 'below-candidate-cut'
  | 'exceeds-budget'
  | 'exceeds-budget-after-compression'
  | 'secret-detected'
  | 'not-found'
  | 'outside-root';

export interface DiscoveredFile {
  path: string;           // relative to root, forward slashes
  absolutePath: string;
  size: number;           // bytes
  language: string | null;
  mtime: Date;
  isBinary: boolean;
  source: 'normal' | 'git-changed' | 'git-dep';
  deleted?: boolean;      // git mode: file was removed in this changeset
  tracked?: boolean;      // git mode: false for untracked files
  hunks?: HunkRange[];    // git diff/staged mode only
}

export interface SignalScores {
  /** 0-1: Filename-based importance (e.g. index.ts=1.0, random.ts=0.1) */
  structural: number;
  /** 0-1: Inverse directory depth, exponential decay */
  depth: number;
  /** 0-1: Gaussian decay around optimal file size (penalizes empty and massive files) */
  size: number;
  /** 0-1: Base weight assigned to the file extension */
  extension: number;
  /** 0-1: Keyword match score against the user's query (only if query is provided) */
  keyword: number;
  /** 0-1: File modification recency score (only if git mode is active) */
  recency: number;
}

export interface RankedFile extends DiscoveredFile {
  score: number;
  signalScores: SignalScores;
}

export interface BudgetFile extends RankedFile {
  content: string;          // possibly compressed
  tokens: number;           // fast estimate used during fitting
  accurateTokens: number;   // tiktoken count after selection
  compressed: boolean;
  compressionLevel: CompressionLevel;
  rankPosition?: number;
}

export interface ExcludedFile {
  path: string;
  reason: ExclusionReason;
}

export interface TokenBudget {
  maxTokens: number;
  reserveForResponse: number;
  reserveForPrompt: number;
  effectiveBudget: number;  // maxTokens - reserves
}

export interface SecurityFinding {
  filePath: string;
  patternName: string;
  line: number;
}

/** Hit/miss counters for a single cache over one pipeline run.
 *
 *  Only directly-measured quantities are reported. There is deliberately no
 *  "time saved" field: the pipeline cannot know how long the avoided work would
 *  have taken without doing it, so any such number would be a guess presented as
 *  a measurement. */
export interface CacheStat {
  /** Lookups served from cache. */
  hits: number;
  /** Lookups that missed (absent, or present with a stale content hash). */
  misses: number;
  /** Entries written or updated during this run. */
  writes: number;
  /** Bytes of input content served from cache instead of being recomputed.
   *  For the LLM cache this is content that was NOT sent to a remote API. */
  bytesFromCache: number;
}

/** Per-cache statistics for one pipeline run. Caches that never ran are absent
 *  rather than zeroed, so consumers can distinguish "unused" from "0% hit rate". */
export interface CacheStats {
  /** Content-hash cache of accurate token counts and traced imports. */
  file: CacheStat;
  /** LLM summary cache — present only when tier3-llm compression ran. */
  llm?: CacheStat;
  /** Embedding cache — present only when semantic query reranking ran. */
  embedding?: CacheStat;
}

export interface PackResult {
  included: BudgetFile[];
  excluded: ExcludedFile[];
  totalTokens: number;
  outputTokens: number;   // fast estimate of the full serialized output (includes formatting overhead)
  budget: TokenBudget | null; // null when --no-budget
  format: OutputFormat;
  output: string;
  parsed?: {
    metadata: { version: string; generated: string; repository: string; tokens: number; budget: number | null; fileCount: number };
    files: Array<{ path: string; language: string | null; tokens: number; rank: number; content: string; compressed: boolean; compressionLevel: string; deleted: boolean }>;
    preamble: string | null;
    instructions: string | null;
    tree: string | null;
  };
  timingMs: number;
  cacheStats: CacheStats;
}

export interface IgnoreConfig {
  useGitignore: boolean;
  useDefaultPatterns: boolean;
  customPatterns: string[];
}

export interface RankingConfig {
  keywords: string[];
  pinned: string[];
}

/** A subset of RepoCodeConfig that can be stored as a named preset.
 *  `description` is display-only and stripped before merging. */
export type PresetConfig = Partial<Omit<RepoCodeConfig, 'presets'>> & {
  description?: string;
};

export interface RepoCodeConfig {
  root: string;
  maxFileSizeBytes: number;
  maxCandidates?: number;
  concurrency?: number;
  output: {
    format: OutputFormat;
    filePath: string | null;   // null = derive from format
    stdout: boolean;
    copy: boolean;
    showLineNumbers: boolean;
    includeTree: boolean;
    preamble: boolean;
    instructionFile: string | null;
    headerText: string;
    includeScores: boolean;  // include per-file score/signals in JSON output
  };
  budget: {
    maxTokens: number | null;  // null = --no-budget
    reserveForResponse: number;
    reserveForPrompt: number;
  };
  include: string[];
  exclude: string[];
  ignore: IgnoreConfig;
  ranking: RankingConfig;
  security: {
    enabled: boolean;
    mode: SecurityMode;
  };
  compress: CompressConfig;
  graphDepth: number;  // 0 = disabled; ≥1 = enabled (default: 2)
  verbose: boolean;
  dryRun: boolean;
  git?: GitConfig;  // absent = normal discovery mode
  stdinFiles?: string[];  // present = stdin discovery mode (a file list, not raw stdin text)
  /** Named presets stored in repocode.config.json — not used by the pipeline itself */
  presets?: Record<string, PresetConfig>;
  llm?: LLMConfig;
  query?: string;
  queryConfig?: QueryConfig;
  instruction?: InstructionConfig;
  instructions?: Record<string, InstructionDef>;
}

export interface TUIFile extends RankedFile {
  content: string;  // file content read during TUI init, reused on pack
  tokens: number;   // fast token estimate (character-based heuristic)
}

export interface TUIPipelineResult {
  files: TUIFile[];                // all ranked non-binary files, sorted by score desc
  imports: Map<string, string[]>;  // root-relative path → root-relative direct import paths
}
