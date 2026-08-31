# RepoCode — Architecture & Code Organization

## Overview

RepoCode is a **TypeScript strict ESM pnpm monorepo**. Three packages publish to npm and share a single dependency — `@repocode/core`, which owns the entire pipeline — importing the library directly rather than spawning the CLI as a subprocess. A fourth package, `packages/github-action`, is not published to npm; it's consumed as a GitHub Action and takes the opposite approach, shelling out to the published `repocode` CLI as a subprocess (it has no workspace dependency on `@repocode/core`).

A VS Code/Cursor/Windsurf extension is planned but has no source or package manifest in this tree yet — see "Planned: editor extension" below.

---

## Repository Structure

```
RepoCode/
├── packages/
│   ├── core/               → npm: @repocode/core
│   ├── cli/                → npm: repocode
│   ├── mcp/                → npm: @repocode/mcp
│   ├── github-action/      → not on npm; consumed via `uses: owner/repo@tag`
│   ├── bench/               gitignored — SWE-bench Lite harness, local only
│   └── stats/                gitignored — raw benchmark result CSVs, local only
├── action.yml               Root manifest for the GitHub Action (points at packages/github-action)
├── scripts/
│   ├── bump-version.js     Synchronise versions across the three npm packages
│   └── release.sh          One-command release helper
├── .github/workflows/
│   ├── ci.yml              Run tests on every push and PR
│   └── release.yml         Publish the three npm packages on v* tags
├── docs/
│   └── architecture.md     This file
├── examples/                 Runnable shell scripts for the workflows in the README
├── llms.txt                  LLM-discoverable pointer to docs and package layout
├── results/                  Trimmed SWE-bench Lite CSVs backing the README's comparison table
├── pnpm-workspace.yaml
└── README.md
```

---

## Dependency Graph

```
@repocode/core   (no internal project dependencies)
        ↑
   ┌────┴────┐
   │         │
  cli       mcp
```

Both consumer packages declare `"@repocode/core": "workspace:*"` in their `package.json`. pnpm resolves this to the exact version at publish time. CLI and MCP are completely independent of each other — neither depends on the other.

---

## Package 1: `packages/core` → `@repocode/core` on npm

**Role:** The engine. Pure TypeScript library — no CLI, no editor API, no protocol. Every feature lives here; the other packages are thin wrappers around it.

### Source layout

```
packages/core/src/
├── pipeline.ts             runPipeline() — main entry point; orchestrates all stages
├── types/                  All shared TypeScript types (RepoCodeConfig, PackResult, …)
├── config/
│   ├── defaults.ts         DEFAULT_CONFIG
│   └── loader.ts           loadConfig(root, overrides) — reads RepoCode.config.json
├── discovery/
│   ├── fileDiscovery.ts    Glob-based file discovery, respects .gitignore
│   └── ignoreRules.ts      buildIgnoreFilter() — gitignore-style predicate
├── ranking/
│   ├── pass1Ranker.ts      Structural signals: extension tier, depth, size, keywords, recency
│   ├── pass2Ranker.ts      Blends token-density with import-graph centrality for budget-fitting
│   ├── graphBuilder.ts     buildGraph() — static import graph, all 8 resolved languages
│   └── signals.ts          Individual signal scorers
├── query/
│   ├── index.ts            Query processing and TF-IDF / Semantic reranking
│   └── semanticScorer.ts   Local embedding-based similarity scoring
├── tokens/
│   ├── fastEstimator.ts    Character-heuristic token count (no dependencies)
│   ├── accurateEstimator.ts tiktoken-based accurate count (cache-aware)
│   └── encoderWorker.ts    Worker thread for token estimation
├── budget/
│   ├── budgetFitter.ts     fitToBudget() — iterative trim loop with pLimit concurrency
│   ├── compression.ts      Tier 1 (regex) + Tier 2 (structural) compressors
│   └── partialExtractor.ts Extract only relevant hunks from large files
├── compression/
│   ├── llmCompressor.ts    Tier 3 (LLM) compression with retry/backoff logic
│   └── providers/          Factory and adapters for OpenAI, Anthropic, Ollama, Custom
├── instructions/
│   └── builtinInstructions.ts Standard templates and system prompts
├── languageResolvers/
│   ├── index.ts            Dispatches to the resolver for a file's language
│   ├── types.ts            Shared resolver interface
│   ├── typescript.ts       Also covers JavaScript — no separate JS resolver
│   ├── python.ts
│   ├── go.ts
│   ├── rust.ts
│   ├── java.ts
│   ├── ruby.ts
│   ├── php.ts
│   ├── cpp.ts               C/C++
│   └── csharp.ts           Namespace → directory (not namespace → file, unlike Java);
│                           `using static`/aliased/`global using` deliberately unsupported
├── output/
│   ├── assembler.ts        Assembles final output string
│   ├── treeGenerator.ts    Directory tree renderer
│   └── formatters/         XML, Markdown, Plain Text, JSON
├── git/
│   ├── gitDiscovery.ts     File discovery for git modes (diff/staged/log/branch/pr/range)
│   ├── importTracer.ts     Transitive import tracing for git-changed files
│   ├── modes.ts            Git mode orchestration
│   └── runner.ts           Safe git command execution
├── cache/
│   └── fileCache.ts        FileCache — per-file SHA-256 content-hash cache
├── watch/
│   └── watcher.ts          startWatch() — chokidar watcher, debounce, overlap guard
├── security/
│   └── secretScanner.ts    Detect secrets/credentials in file content (dynamic @secretlint)
└── utils/
    ├── pLimit.ts           Concurrency limiting helper
    └── atomicWrite.ts      Safe filesystem write operations
```

### Key public API (exported from `index.ts`)

```typescript
// Pipeline
runPipeline(config, options?)          → Promise<PackResult>
loadConfig(root, overrides)            → Promise<RepoCodeConfig>

// Watch
startWatch(options: WatchOptions)      → Promise<WatchHandle>

// Cache
FileCache.load(root)                   → FileCache
cache.get(relPath, content)            → CacheFileEntry | undefined
cache.set(relPath, content, data)      → void
cache.prune(livePaths)                 → void
cache.save()                           → void

// Utilities
buildIgnoreFilter(root, config)        → Promise<(path: string) => boolean>
discoverFiles(options)                 → Promise<DiscoveredFile[]>
buildGraph(root, ignore, cache?)       → Promise<BuildGraphResult>
estimateFast(content)                  → number
generateTree(files, root)              → string
```

---

## Package 2: `packages/cli` → `repocode` on npm

**Role:** The command-line tool. Parses flags, calls `runPipeline`, manages output files, and provides the interactive TUI and watch mode.

### Source layout

```
packages/cli/src/
├── cli.ts                  Entry point — Commander setup, all flags, action dispatch
└── commands/
    ├── pack.ts             One-shot pack (default mode)
    ├── watch.ts            --watch mode — registers SIGTERM/SIGINT, calls startWatch()
    ├── interactive.ts      --interactive mode — Ink TUI, packFromSelection()
    ├── mcpServer.ts        RepoCode mcp-server subcommand
    └── buildConfig.ts      Shared: CLI flags → RepoCodeConfig
        tui/
        ├── App.tsx                 Root Ink component
        ├── constants.ts
        ├── fileListUtils.ts        Pure file-list manipulation
        ├── hooks/
        │   ├── useFileList.ts      File list state (search, toggle, cursor)
        │   └── useProfiles.ts      Named profile save/load
        └── components/
            ├── FileList.tsx        Virtualised scrollable file list
            ├── FileRow.tsx         Single file row
            ├── StatusBar.tsx       Token count + file count bar
            ├── SearchBar.tsx       Incremental search input
            ├── Footer.tsx          Key bindings help
            └── ProfilePrompt.tsx   Profile name input overlay
```

### What it adds over core

- Flag parsing (Commander) — 30+ CLI options
- Output file writing, clipboard copy (`--copy`)
- Dry-run preview (`--dry-run`)
- Terminal UI (Ink/React) for interactive file selection
- Profile management (saved file selections)
- Watch process lifecycle — SIGTERM/SIGINT handlers registered before `startWatch()` to close a race window where signals can arrive before handlers are set up

---

## Package 3: `packages/mcp` → `@repocode/mcp` on npm

**Role:** MCP server. Exposes the core pipeline as tools consumable by AI assistants over STDIO transport.

### Source layout

```
packages/mcp/src/
├── server.ts               MCP server setup, createServer(), startServer()
├── bin.ts                  #!/usr/bin/env node shim — enables npx -p @repocode/mcp repocode-mcp
├── configMapper.ts         Maps MCP tool parameters → RepoCodeConfig
├── tools/
│   ├── packRepository.ts   pack_repository — full pipeline with ranking + compression
│   ├── searchFiles.ts      search_files — regex content search across discovered files
│   ├── getFileContext.ts   get_file_context — file + transitive import graph
│   ├── getGitContext.ts    get_git_context — diff/log/branch changes
│   ├── getArchitecture.ts  get_architecture — structural overview of the codebase
│   ├── getContext.ts       get_context — task-scoped repo slice within a token budget, query-aware
│   └── explainSelection.ts explain_selection — why files were/weren't selected, per-signal breakdown
├── output/
│   └── compactExplain.ts   Compact formatter for explain_selection's report
└── resources/
    ├── listFiles.ts        list_files — file metadata (path, size, token estimate)
    └── getFile.ts          get_file — single file content
```

`get_context` and `explain_selection` thread the existing query-reranking support through
`configMapper.ts`, which the other tools don't use — they're task-oriented, unlike the
`pack_codebase`-shaped tools that predate them (kept alongside, not replaced).

### What it adds over core

- MCP protocol layer (`@modelcontextprotocol/sdk`)
- STDIO transport (reads from stdin, writes to stdout — compatible with all MCP clients)
- Parameter mapping: converts JSON tool arguments to `RepoCodeConfig`
- `bin.ts` shebang shim so `npx -p @repocode/mcp repocode-mcp` works without global install

### How to connect

Any MCP-compatible client (Claude Desktop, Cursor, etc.) adds this to its config:

```json
{
  "mcpServers": {
    "repocode": {
      "command": "npx",
      "args": ["-y", "-p", "@repocode/mcp", "repocode-mcp"]
    }
  }
}
```

---

## Package 4: `packages/github-action` (not published to npm)

**Role:** GitHub Action that fails a PR's check when the diff plus its required import context doesn't fit a configured token budget. The one package that does *not* import `@repocode/core` — it shells out to the published `repocode` CLI as a subprocess instead, so it stays dependency-free.

### Source layout

```
packages/github-action/
├── src/
│   ├── classify.mjs        Pure classification logic: does the diff fit the budget?
│   └── index.mjs           Entrypoint — resolves the PR base ref, invokes the CLI, sets outputs
└── tests/
    └── classify.test.mjs
```

Consumed directly from the root `action.yml` via `uses: owner/repo@tag`, not installed from npm. CI self-tests it against this repository's own PRs (`action-self-test` job in `ci.yml`, gated to `pull_request` events).

---

## Planned: editor extension

A VS Code/Cursor/Windsurf extension (`packages/vscode-extension`) is planned — designed to wrap `runPipeline`/`startWatch` the same way the CLI and MCP server do, bundled with esbuild and published to both the VS Code Marketplace and Open VSX — but it has no source or package manifest in this tree yet, so it's not part of the build, release, or version-bump steps described below.

---

## CI/CD Pipeline

### CI workflow (`.github/workflows/ci.yml`)

Triggers on every push to `main` or a `v*` branch, and on every pull request to `main`.

```
checkout → pnpm install (frozen) → pnpm audit --audit-level=high → pnpm -r build
→ pnpm -r typecheck → pnpm -r test → node packages/cli/dist/cli.js --version
→ pnpm --filter @repocode/core test:perf
```

`pnpm -r build` respects topological order: `core` builds before `cli` and `mcp`. The `test` script in every package runs `vitest run` (Vitest unit tests only). `test:perf` is CI-only and not part of `pnpm -r test`: it packs a synthetic 10,000-file repo and asserts a wall-clock ceiling (180s end-to-end, 2s for ranking alone), guarding a regression class a whole-pipeline token budget can hide.

A separate `action-self-test` job runs only on `pull_request` events: it exercises `packages/github-action` against this repository's own PR diff, both the expected-fail path (a 1-token budget) and the expected-pass path.

### Release workflow (`.github/workflows/release.yml`)

Triggers on any tag matching `v*` (e.g. `v1.0.0`).

```
checkout
→ pnpm install (frozen)
→ pnpm -r build
→ pnpm -r typecheck
→ pnpm -r test             ← fail-fast gate before any publish
→ publish @repocode/core   (npm, --provenance, needs NPM_TOKEN)
→ publish @repocode/mcp    (npm, --provenance, needs NPM_TOKEN)
→ publish repocode         (npm, --provenance, needs NPM_TOKEN)
```

`--provenance` needs `permissions: id-token: write`, granted at the job level in `release.yml`. `packages/github-action` is deliberately absent from this pipeline — it isn't versioned or published here at all.

**Publish order matters:** `@repocode/core` must be on npm before `@repocode/mcp` and `repocode` are installed by end users (since those two depend on it). Within `cli` and `mcp`, the order between them doesn't matter — neither depends on the other.

### Required GitHub secrets

| Secret | Where to create | Used by |
|---|---|---|
| `NPM_TOKEN` | npmjs.com → Access Tokens → Automation | npm publish steps |

---

## Version Management

All three packages share the same version number. The `scripts/bump-version.js` script updates all three `package.json` files atomically:

```bash
node scripts/bump-version.js 1.0.0
# Updates packages/core, packages/cli, packages/mcp
```

`workspace:*` dependencies between packages (e.g. `"@repocode/core": "workspace:*"` in the CLI) are automatically resolved to the concrete version by pnpm at publish time — no manual dep-version updates needed.

The convenience wrapper `scripts/release.sh` runs the full sequence:

```bash
./scripts/release.sh 1.0.0
# → bumps all versions → commits → tags v1.0.0 → git push → git push --tags
# GitHub Actions takes over from there
```

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Direct library import (no subprocess) | CLI and MCP both import `@repocode/core` directly. No stdout parsing, no process spawning overhead, full TypeScript types throughout. |
| Per-file content-hash cache | SHA-256 of file content as cache key — immune to mtime drift from git operations. Only re-runs tiktoken and import extraction on files that actually changed. |
| SIGTERM handler registered before `startWatch()` | The "Watching" log line is printed inside `startWatch` before it returns. Registering signal handlers first closes a race window where a SIGTERM arriving right after that log line would find no handler and kill the process with exit code `null`. |
| `onlyBuiltDependencies` in `pnpm-workspace.yaml` | pnpm 10 requires explicit allowlisting of packages whose `postinstall` build scripts are permitted to run. Without this, `pnpm install --frozen-lockfile` fails in CI for packages like `esbuild`. |
| Import resolution: known unsupported cases | `tsconfig.json`/`jsconfig.json` `extends` chains are not followed (only the root config's own `paths`/`baseUrl` are read); a `paths` value may only use a single `*` wildcard or an exact key, not an arbitrary glob; Python's bare `from . import x` (importing the enclosing package itself, not a named module within it) is not resolved; a dynamic `import()`/`require()` call with a computed (non-string-literal) path is not captured; C#'s `using static Type;`, `using Alias = X.Y.Z;`, and `global using X.Y.Z;` directives are not resolved — only a plain `using X.Y.Z;` namespace import is. |
