import type { RepoCodeConfig, CompressConfig, QueryMode } from '../types.js';

export const DEFAULT_CONFIG: RepoCodeConfig = {
  root: process.cwd(),
  maxFileSizeBytes: 1_000_000, // 1 MB; override with --max-file-size
  concurrency: 4,
  output: {
    format: 'xml',
    filePath: null,
    stdout: false,
    copy: false,
    showLineNumbers: false,
    includeTree: true,
    preamble: true,
    instructionFile: null,
    headerText: '',
    includeScores: false,
  },
  budget: {
    maxTokens: 100_000,
    reserveForResponse: 4_000,
    reserveForPrompt: 2_000,
  },
  include: [],
  exclude: [],
  ignore: {
    useGitignore: true,
    useDefaultPatterns: true,
    customPatterns: [],
  },
  ranking: {
    keywords: ['auth', 'core', 'api', 'db', 'service', 'middleware', 'model', 'route', 'handler'],
    pinned: [],
  },
  security: {
    enabled: true,
    mode: 'warn',
  },
  compress: 'partial' as CompressConfig,
  graphDepth: 2,
  verbose: false,
  dryRun: false,
  llm: undefined,
  query: undefined,
  queryConfig: {
    mode: 'keyword' as QueryMode,
    boostFilename: 3.0,
    boostExports: 2.5,
    boostImports: 2.0,
    boostComments: 1.5,
    maxEmbedFiles: 200,
  },
  instruction: undefined,
  instructions: {},
};
