// packages/core/src/index.ts
export { runPipeline, runPipelineForTUI, packFromSelection } from './pipeline.js';
export { loadConfig, savePreset, listUserPresets } from './config/loader.js';
export type { LoadConfigOptions } from './config/loader.js';
export { DEFAULT_CONFIG } from './config/defaults.js';
export { translateRepomixConfig, loadRepomixConfig, loadRepomixIgnore } from './config/fromRepomix.js';
export type { RepomixConfig, TranslationResult } from './config/fromRepomix.js';
export { budgetForModel, knownModels, knownModelNames, MODEL_BUDGETS, MODEL_TABLE_VERIFIED_ON } from './config/modelBudgets.js';
export type { ModelSpec } from './config/modelBudgets.js';
export type {
  RepoCodeConfig, PackResult, DiscoveredFile, BudgetFile,
  ExcludedFile, OutputFormat, SecurityMode, CompressionLevel,
  GitMode, GitChangedFile, TraceResult, GitConfig, HunkRange,
  TUIFile, TUIPipelineResult, PresetConfig,
  CompressConfig, SelectiveCompressConfig, LLMConfig, LLMProviderName,
  QueryConfig, QueryMode, InstructionDef, InstructionConfig,
  CacheStat, CacheStats,
} from './types.js';
export { getCompressionTier } from './types.js';
export { traceImports } from './git/importTracer.js';
// buildGraph/BuildGraphResult are deliberately not exported: import-graph
// construction is an internal ranking detail, not something a consumer of
// runPipeline should need to drive.
export { buildIgnoreFilter } from './discovery/ignoreRules.js';
export { discoverFiles } from './discovery/fileDiscovery.js';
export { generateTree } from './output/treeGenerator.js';
export { estimateFast } from './tokens/fastEstimator.js';
// FileCache is public because runPipeline accepts one via its `cache` option and
// startWatch threads it across repacks — consumers building their own watch loop
// need it. Its CacheFileEntry payload type stays internal.
/** @internal Exported for startWatch cache threading. Not part of the stable public API. */
export { FileCache } from './cache/fileCache.js';
export { startWatch } from './watch/watcher.js';
export type { WatchOptions, WatchHandle } from './watch/watcher.js';
/** @internal Exported for startWatch cache threading. Not part of the stable public API. */
export { ContentHashCache } from './utils/contentCache.js';
export { atomicWriteFileSync } from './utils/atomicWrite.js';
export { normalizeCompressConfig } from './compression/normalizeCompressConfig.js';
export { rerank } from './query/index.js';
export { resolveInstruction, listInstructions, BUILTIN_INSTRUCTIONS } from './instructions/index.js';
