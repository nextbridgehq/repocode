# @repocode/core

Core engine for RepoCode — repository analysis, ranking, token-budgeting, and AI-ready context assembly. Use this package to embed context packing in your own tools.

Developed by [Nextbridge](https://nextbridge.org).

## Why embed RepoCode?

When building your own AI tools, agents, or editor extensions, naive file-globbing and string concatenation quickly hit token limits or silently drop important context. `@repocode/core` provides a full, unopinionated pipeline to discover files, trace import graphs, rank files by structural importance, and squeeze the most useful context into a strict token budget. It handles the parsing, ranking, git diffs, caching, and token counting so your tool can focus on the AI experience.

## Install

```bash
npm install @repocode/core
```

## Quick Start

```typescript
import { loadConfig, runPipeline } from '@repocode/core';

const config = await loadConfig('/path/to/repo', {
  budget: { maxTokens: 100000 },
  output: { format: 'xml' },
});

const result = await runPipeline(config);
console.log(result.output);           // packed context string
console.log(result.totalTokens);      // accurate token count of included files
console.log(result.outputTokens);     // estimated tokens of the full serialized output
console.log(result.included.length);  // number of files included
```

## API

### `loadConfig(root, overrides, preset?, options?)`

```typescript
loadConfig(
  root: string,
  overrides: Partial<RepoCodeConfig>,
  preset?: string,
  options?: { allowJsConfig?: boolean }
): Promise<RepoCodeConfig>
```

Reads `repocode.config.json` from `root`, deep-merges with `overrides`, applies the optional named `preset`, and returns a fully resolved config.

- `root` — absolute path to the repository root
- `overrides` — any config fields to override after reading the file
- `preset` — name of a language preset to apply (`ts-library`, `py-service`, `go-service`, `rust-crate`, `java-maven`)
- `options.allowJsConfig` — if `true`, also accepts `repocode.config.js` / `.mjs` files (CLI mode); default is `false` — omit or set `false` in server/MCP contexts to block arbitrary code execution

### `runPipeline(config)`

```typescript
runPipeline(config: RepoCodeConfig): Promise<PackResult>
```

Runs the full pipeline: discover → rank → budget-fit → compress → assemble → format. Returns a `PackResult`.

### `startWatch(options)`

```typescript
startWatch(options: {
  config: RepoCodeConfig;
  debounceMs?: number;
  onRepack: (result: PackResult, changedPaths?: string[]) => void | Promise<void>;
  onError?: (err: Error) => void;
}): Promise<{ stop: () => Promise<void> }>
```

Starts a file watcher on `config.root`. Calls `onRepack` after each debounced change batch. Returns a handle with `stop()`, which waits for any in-flight repack to complete before closing the watcher.

- `debounceMs` — milliseconds to wait after the last change before repacking (default: `2000`)
- `onRepack` — called with the new `PackResult` and the list of changed file paths
- `onError` — optional; called if the watcher or pipeline throws

## Key Types

### `PackResult`

```typescript
interface PackResult {
  output: string;           // the packed context string
  totalTokens: number;      // accurate token count of included files
  outputTokens: number;     // estimated tokens of the full serialized output
  included: BudgetFile[];   // files that made it in
  excluded: ExcludedFile[]; // files that were cut, with reason
  budget: TokenBudget | null; // null when --no-budget
  timingMs: number;         // pipeline wall time in milliseconds
}
```

`outputTokens` is a fast character-heuristic estimate of the serialized output size — useful for checking whether the output will fit in an LLM context window.

### `RepoCodeConfig` (key fields)

```typescript
interface RepoCodeConfig {
  root: string;
  budget: { maxTokens: number } | false;
  output: {
    format: 'xml' | 'markdown' | 'plain' | 'json';
    path?: string;
    preamble: boolean;
  };
  compress: 'none' | 'tier1-regex' | 'tier2-structural' | 'tier3-llm' | 'partial' | SelectiveCompressConfig;
  security: {
    enabled: boolean;
    mode: 'warn' | 'exclude' | 'redact' | 'fail';
  };
  include: string[];
  exclude: string[];
}
```

## TypeScript

The package ships full `.d.ts` declarations. No `@types/` install needed. Requires TypeScript 5+ and `"moduleResolution": "bundler"` or `"node16"`.

## Security Notes (MCP / server usage)

When embedding `@repocode/core` in a server or MCP context:

- Pass `allowJsConfig: false` (the default) to `loadConfig` — this blocks `.js`/`.mjs` config files and prevents arbitrary code execution triggered by a malicious repository
- Use `security.mode: 'redact'` to replace detected secrets (API keys, tokens, private key headers) with `[REDACTED]` before any LLM compression call or cache write

## Links

- [repocode](https://www.npmjs.com/package/repocode) — CLI tool
- [@repocode/mcp](https://www.npmjs.com/package/@repocode/mcp) — MCP server
- [GitHub](https://github.com/nextbridgehq/repocode)
