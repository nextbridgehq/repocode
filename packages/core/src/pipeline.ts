// packages/core/src/pipeline.ts
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { RepoCodeConfig, PackResult, TokenBudget, ExcludedFile, TUIFile, TUIPipelineResult, CompressConfig, BudgetFile, CacheStats } from './types.js';
import { discoverFiles } from './discovery/fileDiscovery.js';
import { rankPass1 } from './ranking/pass1Ranker.js';
import { rankPass2, densityScaleFor } from './ranking/pass2Ranker.js';
import { buildGraph } from './ranking/graphBuilder.js';
import { fitToBudget } from './budget/budgetFitter.js';
import { computeBudget } from './budget/computeBudget.js';
import { scanForSecrets } from './security/secretScanner.js';
import { applyStableOrder, mergeOrder, loadOrder, saveOrder, hashContent } from './output/stableOrder.js';
import { generateTree } from './output/treeGenerator.js';
import { assemble, formatOutput } from './output/assembler.js';
import { estimateFast } from './tokens/fastEstimator.js';
import { gitDiscovery } from './git/gitDiscovery.js';
import { buildIgnoreFilter } from './discovery/ignoreRules.js';
import { FileCache } from './cache/fileCache.js';
import { LLMCache } from './compression/llmCache.js';
import { resolveProvider } from './compression/providers/factory.js';
import type { LLMProvider } from './compression/providers/types.js';
import { rerank } from './query/index.js';
import { EmbeddingCache } from './query/embeddingCache.js';
import { DEFAULT_CONFIG } from './config/defaults.js';
import { resolveInstruction } from './instructions/index.js';
import { normalizeCompressConfig } from './compression/normalizeCompressConfig.js';

const DEFAULT_QUERY_CONFIG = DEFAULT_CONFIG.queryConfig!;

/** Gather per-cache counters for PackResult. Caches that did not run are omitted
 *  rather than reported as zeroed, so "unused" stays distinguishable from
 *  "ran and never hit". */
function collectCacheStats(
  fileCache: FileCache,
  llmCache?: LLMCache,
  embeddingCache?: EmbeddingCache,
): CacheStats {
  return {
    file: fileCache.stats(),
    ...(llmCache ? { llm: llmCache.stats() } : {}),
    ...(embeddingCache ? { embedding: embeddingCache.stats() } : {}),
  };
}

function needsLLMProvider(compress: CompressConfig): boolean {
  const { top10, top50, rest } = normalizeCompressConfig(compress);
  return [top10, top50, rest].some(l => l === 'tier3-llm');
}

async function runSecurityScan(
  files: BudgetFile[],
  config: RepoCodeConfig,
  allExcluded: ExcludedFile[],
): Promise<void> {
  if (!config.security.enabled) return;
  for (let i = files.length - 1; i >= 0; i--) {
    const file = files[i];
    const result = await scanForSecrets(file.path, file.content, config.security.mode);
    if (result.findings.length === 0) continue;
    if (config.security.mode === 'exclude') {
      allExcluded.push({ path: file.path, reason: 'secret-detected' });
      files.splice(i, 1);
    } else if (config.security.mode === 'redact' && result.redactedContent) {
      file.content = result.redactedContent;
      file.tokens = estimateFast(file.content);
      file.accurateTokens = file.tokens;
    } else if (config.security.mode === 'fail') {
      throw new Error(`Secret detected in ${file.path}: ${result.findings[0].patternName}`);
    } else if (config.security.mode === 'warn') {
      process.stderr.write(`[repocode] warning: Secret detected in ${file.path}: ${result.findings.map(f => f.patternName).join(', ')}\n`);
    }
  }
}

function resolveInstructionText(
  config: RepoCodeConfig,
  filesCount: number,
): string | undefined {
  if (!config.instruction) return undefined;
  let gitBranch = '';
  try {
    gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: config.root, encoding: 'utf-8' }).trim();
  } catch { /* not a git repo */ }
  const instrCtx = {
    filesCount,
    gitBranch,
    repoName: path.basename(config.root),
    date: new Date().toISOString().slice(0, 10),
  };
  return resolveInstruction(config.instruction, config.instructions ?? {}, instrCtx, config.root) ?? undefined;
}

function assembleAndFormat(
  included: BudgetFile[],
  config: RepoCodeConfig,
  totalTokens: number,
  budget: TokenBudget | null,
  instructionText: string | undefined,
  tree: string,
): string {
  const ctx = assemble(included, {
    root: config.root,
    headerText: config.output.headerText,
    preamble: config.output.preamble,
    instructionFile: config.output.instructionFile,
    instructionText,
    budget: budget?.maxTokens ?? null,
    includeScores: config.output.includeScores,
    // A timestamp in the header changes the first bytes of every pack, so it defeats prompt
    // caching however stable the file ordering below it is.
    omitVolatileMetadata: config.output.stableOrder,
  }, totalTokens, tree);
  return formatOutput(ctx, config.output.format);
}


/** Share of the budget a query run holds back from admission so the top-ranked files can be upgraded
 *  to whole files. Tuned on SWE-bench Lite at 50k; see CHANGELOG. */
const QUERY_UPGRADE_RESERVE = 0.85;

export async function runPipeline(
  config: RepoCodeConfig,
  options?: { cache?: FileCache },
): Promise<PackResult> {
  const cache = options?.cache ?? FileCache.load(config.root);
  const start = Date.now();
  const allExcluded: ExcludedFile[] = [];

  // Pre-stage: if git mode + graphDepth > 0, build the import graph now so traceImports
  // can reuse it instead of re-reading all source files a second time.
  let prebuiltImportMap: Map<string, string[]> | undefined;
  let cachedCentralityMap: Map<string, number> | undefined;
  if (config.git && config.graphDepth > 0) {
    const earlyGraph = await buildGraph(config.root, config.ignore, cache);
    prebuiltImportMap = new Map(Object.entries(earlyGraph.imports));
    cachedCentralityMap = earlyGraph.centralityMap;
  }

  // Stage 1: Discovery
  const shouldInclude = await buildIgnoreFilter(config.root, config.ignore);
  let discovered: import('./types.js').DiscoveredFile[];
  if (config.stdinFiles) {
    const { stdinDiscovery } = await import('./discovery/stdinDiscovery.js');
    const result = await stdinDiscovery(config.stdinFiles, config.root);
    discovered = result.files;
    allExcluded.push(...result.excluded);
  } else if (config.git) {
    discovered = await gitDiscovery(config, (p) => !shouldInclude(p), prebuiltImportMap);
  } else {
    discovered = await discoverFiles({
      root: config.root,
      include: config.include,
      exclude: config.exclude,
      ignore: config.ignore,
      maxFileSizeBytes: config.maxFileSizeBytes,
    });
  }

  const deletedFiles = discovered.filter(f => f.deleted);
  const liveFiles    = discovered.filter(f => !f.deleted);

  const nonBinary  = liveFiles.filter(f => !f.isBinary);
  const binaryFiles = liveFiles.filter(f => f.isBinary);
  allExcluded.push(...binaryFiles.map(f => ({ path: f.path, reason: 'binary' as const })));

  // No-budget mode: include everything, skip ranking
  if (config.budget.maxTokens === null) {
    // Accurate count for all files
    const { estimateAccurateBatch } = await import('./tokens/accurateEstimator.js');
    // Unreadable files are excluded rather than silently included as empty strings.
    const budgetFiles: Array<typeof nonBinary[0] & {
      content: string; tokens: number; accurateTokens: number; compressed: boolean; compressionLevel: 'none';
      score: number; signalScores: { structural: number; depth: number; size: number; extension: number; keyword: number; recency: number };
      deleted?: boolean; tracked?: boolean;
    }> = [];
    for (const f of nonBinary) {
      let content: string;
      try {
        content = fs.readFileSync(f.absolutePath, 'utf-8');
      } catch {
        // Unreadable here means binary or permission-denied — report it, don't emit ''.
        allExcluded.push({ path: f.path, reason: 'binary' });
        continue;
      }
      // Explicit zeroed SignalScores rather than an `as any` cast.
      budgetFiles.push({
        ...f, content, tokens: estimateFast(content), accurateTokens: 0, compressed: false,
        compressionLevel: 'none',
        score: 0,
        signalScores: { structural: 0, depth: 0, size: 0, extension: 0, keyword: 0, recency: 0 },
      });
    }
    const accurateMap = await estimateAccurateBatch(budgetFiles.map(f => f.absolutePath), cache, config.root);
    budgetFiles.forEach(f => { f.accurateTokens = accurateMap.get(f.absolutePath) ?? f.tokens; });

    // The no-budget path still runs the security scan — skipping it here would
    // make --no-budget a way to bypass secret redaction.
    await runSecurityScan(budgetFiles, config, allExcluded);

    // Append deleted file stubs — bypass budget, security, ranking
    for (const f of deletedFiles) {
      budgetFiles.push({
        ...f,
        content: '[DELETED]',
        tokens: 0,
        accurateTokens: 0,
        compressed: false,
        compressionLevel: 'none',
        score: 0,
        signalScores: { structural: 0, depth: 0, size: 0, extension: 0, keyword: 0, recency: 0 },
      });
    }

    const tree = generateTree(budgetFiles.map(f => f.path));
    const totalTokens = budgetFiles.reduce((s, f) => s + f.accurateTokens, 0);
    const instructionText = resolveInstructionText(config, budgetFiles.length);

    cache.prune(new Set(liveFiles.map(f => f.path)));
    cache.save();

    const output = assembleAndFormat(budgetFiles, config, totalTokens, null, instructionText, tree);
    let parsed: unknown;
    if (config.output.format === 'json') {
      try { parsed = JSON.parse(output); } catch { /* ignore parse errors */ }
    }

    return {
      included: budgetFiles, excluded: allExcluded, totalTokens,
      outputTokens: estimateFast(output),
      budget: null, format: config.output.format,
      output,
      // Safe cast: `output` was produced by our own formatJson in this same call,
      // so the parsed shape is guaranteed by construction. JSON.parse cannot know
      // that, hence the assertion rather than a runtime check.
      parsed: parsed as PackResult['parsed'],
      timingMs: Date.now() - start,
      // LLM and embedding caches are constructed later in the budgeted path, so
      // the no-budget path only ever has file-cache activity to report.
      cacheStats: collectCacheStats(cache),
    };
  }

  // Stage 1.5: Graph analysis — centrality map (reuse pre-stage result if git mode already called buildGraph)
  let centralityMap: Map<string, number> | undefined;
  if (config.graphDepth > 0) {
    centralityMap = cachedCentralityMap ?? (await buildGraph(config.root, config.ignore, cache)).centralityMap;
  }

  // Stage 2: Pass 1 Ranking
  const ranked = rankPass1(nonBinary, config.ranking);

  // Stage 2.5: Query-aware reranking (if query is set)
  // Resolve LLM provider early so it can be shared with semantic reranking and tier3-llm compression
  let llmProvider: LLMProvider | undefined;
  let llmCache: LLMCache | undefined;
  let embeddingCache: EmbeddingCache | undefined;

  if (needsLLMProvider(config.compress)) {
    llmProvider = await resolveProvider(config.llm ?? {});
    llmCache = new LLMCache(config.root);
  }

  let reranked = ranked;
  if (config.query) {
    const queryConfig = config.queryConfig ?? DEFAULT_QUERY_CONFIG;
    // Constructed here rather than inside rerank so its counters survive the
    // call and can be reported in cacheStats.
    if (queryConfig.mode === 'semantic') {
      embeddingCache = new EmbeddingCache(config.root);
    }
    reranked = await rerank(
      ranked,
      config.query,
      queryConfig,
      config.root,
      { provider: llmProvider, embeddingCache },
    );
  }

  // Read instruction file content so overhead estimation counts its real tokens.
  let instructionContent = '';
  if (config.output.instructionFile) {
    try { instructionContent = fs.readFileSync(config.output.instructionFile, 'utf-8'); } catch { /* ignore */ }
  }

  // Stage 3: Pass 2 — density + centrality blend, applied to the full ranked set *before*
  // the budget cut. Ranking after the cut made the final order budget-dependent: a larger
  // budget widened the cut, and the newly admitted files — lifted by centrality — interleaved
  // ahead of files the smaller budget had already selected, pushing them past the point where
  // the budget ran out. Ranking first makes the cut a prefix of a fixed order, so a larger
  // budget can only extend the candidate set, never reorder it.
  // The density scale likewise comes from the whole set, so the blend is a property of the
  // repo rather than of whichever subset happens to be in hand.
  // With a query, the reranked score already encodes relevance; density would divide it by
  // file size and bury every large match (see rankPass2).
  const pass2Ranked = rankPass2(
    reranked, config.ranking.pinned, centralityMap, densityScaleFor(reranked), !config.query,
  );

  const { candidates, dropped, budget } = computeBudget(pass2Ranked, config, instructionContent);
  allExcluded.push(...dropped);

  if (config.verbose && candidates.length > 2000) {
    process.stderr.write(`[repocode] note: ${candidates.length} candidate files — memory usage may be elevated\n`);
  }

  // Stage 4: Budget Fitting
  // llmCache is flushed once here rather than after each summary — saving
  // rewrites the whole cache file, so per-summary saves were O(n^2) disk I/O.
  // The flush runs even if fitting throws: LLM summaries cost real API spend and
  // must survive a mid-run provider failure.
  const { included, excluded: fitExcluded } = await fitToBudget(
    candidates,
    {
      pinned: config.ranking.pinned,
      compress: config.compress,
      cache,
      root: config.root,
      llmProvider,
      llmCache,
      llmBudgetTokens: config.llm?.budgetTokens,
      securityMode: config.security.enabled ? config.security.mode : undefined,
      concurrency: config.concurrency,
      // With a query the top of the ranking is what the task needs; give it whole files.
      upgradeOrder: config.query ? 'depth' : 'breadth',
      upgradeReserve: config.query ? QUERY_UPGRADE_RESERVE : undefined,
    },
    budget
  ).finally(() => llmCache?.save());
  allExcluded.push(...fitExcluded);

  // Stage 5: Security Check
  await runSecurityScan(included, config, allExcluded);

  // Append deleted file stubs — they bypass ranking, budget fitting, and security
  for (const f of deletedFiles) {
    included.push({
      ...f,
      content: '[DELETED]',
      tokens: 0,
      accurateTokens: 0,
      compressed: false,
      compressionLevel: 'none',
      score: 0,
      signalScores: { structural: 0, depth: 0, size: 0, extension: 0, keyword: 0, recency: 0 },
    });
  }

  // Stage 5.5: Prompt-cache-stable ordering.
  // Ranking decides which files are packed; it should not decide where they appear. Rank is
  // unstable by design — editing one file changes its score, and if it sat near the front every
  // file behind it shifts. Measured on a 40-file repo, a single edit left consecutive packs
  // sharing a 0% common prefix, so an agent re-packing between turns cached nothing.
  if (config.output.stableOrder) {
    const previousOrder = loadOrder(config.root);
    // Hash the content actually emitted, not the file on disk: a file whose bytes changed but
    // whose compressed form is identical does not break the prefix, and should not be moved.
    const hashOf = (f: BudgetFile) => hashContent(f.content);
    const ordered = applyStableOrder(included, previousOrder, hashOf);
    included.length = 0;
    included.push(...ordered);
    // Persisted against every file still discovered, not just the packed ones, so a file that
    // missed this budget keeps its slot instead of being re-appended when it returns.
    saveOrder(config.root, mergeOrder(
      previousOrder,
      included.map(f => ({ path: f.path, hash: hashOf(f) })),
      new Set(nonBinary.map(f => f.path)),
    ));
  }

  // Stages 6+7: Tree + Output Assembly
  const tree = generateTree(included.map(f => f.path));
  const totalTokens = included.reduce((s, f) => s + f.accurateTokens, 0);
  const instructionText = resolveInstructionText(config, included.length);

  cache.prune(new Set(liveFiles.map(f => f.path)));
  cache.save();

  const output = assembleAndFormat(included, config, totalTokens, budget, instructionText, tree);
  const outputTokens = estimateFast(output);

  let parsed: unknown;
  if (config.output.format === 'json') {
    try { parsed = JSON.parse(output); } catch { /* ignore */ }
  }

  if (budget && outputTokens > budget.maxTokens * 1.05) {
    process.stderr.write(
      `[repocode] note: final output is ${outputTokens.toLocaleString()} tokens ` +
      `(${Math.round((outputTokens / budget.maxTokens) * 100)}% of budget). ` +
      `Overhead from formatting, tree, and metadata accounts for the difference.\n`
    );
  }

  return {
    included, excluded: allExcluded, totalTokens,
    outputTokens,
    budget, format: config.output.format,
    output,
    // Safe cast: `output` was produced by our own formatJson in this same call,
    // so the parsed shape is guaranteed by construction. JSON.parse cannot know
    // that, hence the assertion rather than a runtime check.
    parsed: parsed as PackResult['parsed'],
    timingMs: Date.now() - start,
    cacheStats: collectCacheStats(cache, llmCache, embeddingCache),
  };
}

export async function runPipelineForTUI(config: RepoCodeConfig): Promise<TUIPipelineResult> {
  // Stage 1: Discovery
  let discovered: Awaited<ReturnType<typeof discoverFiles>>;
  if (config.git) {
    const shouldInclude = await buildIgnoreFilter(config.root, config.ignore);
    discovered = await gitDiscovery(config, (p) => !shouldInclude(p));
  } else {
    discovered = await discoverFiles({
      root: config.root,
      include: config.include,
      exclude: config.exclude,
      ignore: config.ignore,
      maxFileSizeBytes: config.maxFileSizeBytes,
    });
  }

  const nonBinary = discovered.filter(f => !f.isBinary && !f.deleted);

  // Stage 1.5: Build import graph (same gating as runPipeline)
  let importsRecord: Record<string, string[]> = {};
  if (config.graphDepth > 0) {
    const graphResult = await buildGraph(config.root, config.ignore);
    importsRecord = graphResult.imports;
  }

  // Pass 1 ranking
  const ranked = rankPass1(nonBinary, config.ranking);

  // Read content + fast token estimates (reused on pack; skip unreadable files)
  const tuiFiles: TUIFile[] = [];
  for (const f of ranked) {
    let content: string;
    try {
      content = fs.readFileSync(f.absolutePath, 'utf-8');
    } catch {
      continue;
    }
    tuiFiles.push({ ...f, content, tokens: estimateFast(content) });
  }

  return {
    files: tuiFiles,
    imports: new Map<string, string[]>(Object.entries(importsRecord)),
  };
}

export async function packFromSelection(
  allFiles: TUIFile[],
  selectedPaths: Set<string>,
  config: RepoCodeConfig,
): Promise<PackResult> {
  const start = Date.now();
  const allExcluded: ExcludedFile[] = [];
  const cache = FileCache.load(config.root);

  // Filter to user's selection (preserves rank order)
  const selectedFiles = allFiles.filter(f => selectedPaths.has(f.path));

  // Compute accurate token counts (tiktoken) for selected files
  const { estimateAccurateBatch } = await import('./tokens/accurateEstimator.js');
  const accurateMap = await estimateAccurateBatch(selectedFiles.map(f => f.absolutePath), cache, config.root);

  // Build BudgetFile[] — no compression at this stage
  let budgetFiles = selectedFiles.map(f => ({
    ...f,
    accurateTokens: accurateMap.get(f.absolutePath) ?? f.tokens,
    compressed: false,
    compressionLevel: 'none' as const,
  }));

  // Apply budget cap (greedy by rank order, which is already the file order)
  const budget: TokenBudget | null = config.budget.maxTokens !== null ? {
    maxTokens: config.budget.maxTokens,
    reserveForResponse: config.budget.reserveForResponse,
    reserveForPrompt: config.budget.reserveForPrompt,
    effectiveBudget: Math.max(0,
      config.budget.maxTokens - config.budget.reserveForResponse - config.budget.reserveForPrompt),
  } : null;

  if (budget !== null) {
    let remaining = budget.effectiveBudget;
    const included = [];
    for (const f of budgetFiles) {
      if (f.accurateTokens <= remaining) {
        included.push(f);
        remaining -= f.accurateTokens;
      } else {
        allExcluded.push({ path: f.path, reason: 'exceeds-budget' });
      }
    }
    budgetFiles = included;
  }

  // Security check
  await runSecurityScan(budgetFiles, config, allExcluded);

  const tree = generateTree(budgetFiles.map(f => f.path));
  const totalTokens = budgetFiles.reduce((s, f) => s + f.accurateTokens, 0);
  const instrText = resolveInstructionText(config, budgetFiles.length);

  cache.prune(new Set(allFiles.map(f => f.path)));
  cache.save();

  const output = assembleAndFormat(budgetFiles, config, totalTokens, budget, instrText, tree);
  let parsed: unknown;
  if (config.output.format === 'json') {
    try { parsed = JSON.parse(output); } catch { /* ignore */ }
  }

  return {
    included: budgetFiles,
    excluded: allExcluded,
    totalTokens,
    outputTokens: estimateFast(output),
    budget,
    format: config.output.format,
    output,
    // Safe cast: `output` was produced by our own formatJson in this same call,
    // so the parsed shape is guaranteed by construction. JSON.parse cannot know
    // that, hence the assertion rather than a runtime check.
    parsed: parsed as PackResult['parsed'],
    timingMs: Date.now() - start,
    cacheStats: collectCacheStats(cache),
  };
}
