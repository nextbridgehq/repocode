# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/).

---

## [0.3.0] — 2026-08-31

### Added

- `@repocode/github-action` budget check: fails a PR's check when the diff and its required import context exceed the configured token budget. Dependency-free ESM, invoking the published CLI; consumed directly as a GitHub Action (`uses: owner/repo@tag`) rather than published to npm. Validated against this repository's own PRs in CI.
- Two new MCP tools: `get_context` packs a task-scoped repository slice within a token budget, and `explain_selection` provides per-signal scoring and explains file inclusion or exclusion. Both integrate the existing query-reranking support through `configMapper`.
- Golden-file coverage for all 8 supported languages and a C# resolver supporting namespace-to-directory mapping (namespace → directory, not namespace → file, unlike Java), including dotted .NET project folders (e.g. `Acme.Billing.Core/Services/`); `using static`, aliased `using`, and `global using` remain intentionally unsupported.
- TypeScript path-alias resolution from `tsconfig`/`jsconfig` `paths`, with protection against aliases escaping the project root.
- CI performance gates: packing a synthetic 10,000-file repository completes within 180s end-to-end, and ranking alone completes within 2s.
- `examples/` — runnable shell scripts for the workflows described in the README (bug hunting, code review, explaining ranking, starting a new AI chat), plus a sample `repocode.config.json`.
- `llms.txt`, so an LLM-based tool can discover RepoCode's docs and package layout without crawling the whole README.
- `results/` — two trimmed SWE-bench Lite CSVs (184 instances total) and a methodology README behind the RepoCode-vs-Repomix comparison used in outreach, so the numbers are independently checkable. The full benchmark harness and exploratory runs stay local, per the existing benchmark-data convention.

### Changed

- Removed unreachable stdlib-filtering logic from the Rust resolver (`std::` imports never reached the code path it guarded — filtering already happened earlier, at extraction).

### Fixed

- Packing a workspace monorepo could hang: file discovery and import-graph building walked into `node_modules` and `dist` instead of pruning them.
- `pnpm audit --audit-level=high` was failing on a command-injection advisory in `repomix`, a devDependency of the private benchmark harness used only as a comparison arm. Overridden to a patched version in `pnpm-workspace.yaml`.
- CI's dependency and audit gate — `pnpm-lock.yaml` and `pnpm-workspace.yaml` were out of sync with what `pnpm audit --audit-level=high` expected.
- `pnpm-lock.yaml` was missing the `@repocode/bench` workspace dependency block.
- Python relative imports (`from . import x`, `from ..pkg import y`) now resolve within the importing file's own package.
- Go import resolution for vendored (`vendor/`) and bare single-line imports (`import "fmt"`, including aliased and blank-identifier forms), including a directory-vs-file resolution bug that previously broke multi-hop traversal and all importer detection for Go.
- Cross-language package-directory leakage (a Go package directory could admit files belonging to an unrelated resolver or language sharing that directory) and vendored imports being incorrectly shadowed by same-named local directories.
- A stale import-resolution cache entry could persist across a resolver upgrade, silently keeping a pre-fix (wrong) resolution alive; the cache version now bumps to invalidate on upgrade.

---

## [0.2.0] — 2026-08-18

### Added

- `--stable-order` emits files in the order they were emitted last run, appending new and changed files at the end. Two packs of an unchanged repository are byte-identical, so an agent re-packing between turns keeps its prompt cache. Measured on a 40-file repo, editing one file went from a 0% to a 100% reusable prefix. Off by default: it trades most-relevant-first ordering for cache reuse.
- `--explain --format json` produces a machine-readable ranking report on stdout — rank, score, per-signal breakdown, compression level, and how much of each file survived compression. Diff it between commits to catch a ranking regression without re-running a benchmark.
- `--max-candidates` caps how many ranked files are considered. Fewer candidates means more budget per file and higher fidelity; more means broader, shallower coverage.
- `--model <name>` sizes the budget from a model's context window, holding back its maximum reply plus 15% of the window for the surrounding conversation — `--model claude-opus-5` is 722,000 tokens. Short aliases (`opus`, `sonnet`, `haiku`) resolve to the current release. An explicit `--budget` still wins, so the flag can be overridden rather than fought, and an unrecognised name is an error listing the known models rather than a guessed budget. Context windows are a dated snapshot of vendor documentation (`MODEL_TABLE_VERIFIED_ON`), because they change faster than this package ships.
- An internal benchmark harness measuring file retrieval against SWE-bench Lite, with oracle and random-draw control arms. Kept private; not published.
- `--help` shows 12 core flags and fits one screen; `--help-advanced` lists everything else (git modes, LLM compression, presets, and more). Hidden flags are still fully functional — only the listing changed.
- AGENTS.md, CLAUDE.md, and GitHub issue/PR templates, documenting how this project is actually built and reviewed.

### Changed

- Ranking is now deterministic. File discovery order was unstable, and score ties inherited it, so identical inputs could produce different output between runs.
- Selection is monotone in the budget: raising the budget can only add files, never drop ones a smaller budget included.
- Compression tiers are treated as alternatives chosen per file rather than a fallback used only on overflow, so a large file enters as a signature instead of crowding out several smaller ones.
- `COMPRESS_MULTIPLIER` recalibrated below 1.0. The previous values assumed compression let the pack usefully carry several times more files than would fit whole; measured, that produced ~300 files retaining ~11% of their content each.
- Query reranking now affects ranking at all. It was previously a no-op: query scores were normalised against the maximum, so one outlier collapsed everything else to zero, and the blend was multiplicative and capped.
- Node floor lowered from 22 to 20.
- README rewritten: an honest RepoCode-vs-Repomix comparison table (including where Repomix wins — maturity, ecosystem surfaces, language breadth), a dogfooding pointer to AGENTS.md, a plainly stated privacy position, and a restructure around a one-liner, quickstart, and three core differentiators (graph traversal, ranking-to-fit, cache-stable output). Supersedes the earlier "Why RepoCode?" pitch, including its narrower tier3-llm framing fix.

### Fixed

- A budget at or below the reserves produced an empty pack with no explanation; it now says so.
- Ranking no longer reads the clock once per file, which leaked evaluation order into scores.
- `sizeScore` is log-scaled; against a repo's largest file it had collapsed every ordinary source file to within a few thousandths of 1.0.
- Default ranking keywords no longer ship as a hardcoded list applied whether or not a query was given.

### Measured

Ranking was evaluated internally against SWE-bench Lite (held-out instances, 50k budget, oracle and random-selection controls). Results varied considerably by repository and were not robust across the full sample. The methodology and figures are kept private rather than published; see [README.md](README.md#how-ranking-is-evaluated) for the current public framing.

---

## [0.1.0] — 2026-08-06

- Initial public release of RepoCode.

---

[0.3.0]: https://github.com/nextbridgehq/repocode/releases/tag/v0.3.0
[0.2.0]: https://github.com/nextbridgehq/repocode/releases/tag/v0.2.0
[0.1.0]: https://github.com/nextbridgehq/repocode/releases/tag/v0.1.0
