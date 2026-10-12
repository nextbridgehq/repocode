# AGENTS.md

Working notes for AI agents contributing to RepoCode. Human contributors: see [CONTRIBUTING.md](CONTRIBUTING.md).

## What this is

RepoCode packs a repository into a token-budgeted context bundle for an LLM. The interesting
part is not concatenating files — it is deciding *which* files, and at what fidelity, when the
budget cannot hold everything. Most of the difficulty in this codebase lives in ranking and
budget fitting.

## Layout

| Package | Published as | What it is |
|---|---|---|
| `packages/core` | `@repocode/core` | Discovery, ranking, compression, budget fitting, output. The engine. |
| `packages/cli` | `repocode` | Commander-based CLI. `bin: repocode`. |
| `packages/mcp` | `@repocode/mcp` | MCP server. `bin: repocode-mcp`. |
| `packages/github-action` | not on npm — consumed as `uses: owner/repo@tag` via the root `action.yml` | GitHub Action that fails a PR's check when the diff plus its import context doesn't fit a budget. Plain ESM, zero dependencies, shells out to the published CLI. |
| `packages/bench` | `private` — never on npm | SWE-bench harness behind [BENCHMARKS.md](BENCHMARKS.md). Tracked; see its [README](packages/bench/README.md). |
| `packages/stats` | gitignored | Raw benchmark result CSVs. Data, not code — local only, never committed. |

The pack pipeline is `packages/core/src/pipeline.ts`, and reading it top to bottom is the
fastest way to understand the system: discover files → build the import graph (its centrality
map is an input to ranking, so it comes first) → rank pass 1 → rank pass 2 → fit to budget →
apply stable ordering → scan for secrets → assemble.

## Commands

```bash
pnpm install
pnpm audit --audit-level=high   # dependency vulnerability gate
pnpm -r build       # tsc, per package
pnpm -r typecheck   # tsc --noEmit
pnpm -r test        # vitest run — 977 passing, 1 skipped (core 625, cli 207, mcp 62, bench 45, github-action 38)
pnpm --filter @repocode/core test:perf   # synthetic 10k-file pack, wall-clock regression gate —
                                         # CI-only, not part of `pnpm -r test`
```

CI runs exactly these six plus `node packages/cli/dist/cli.js --version`. There is no linter
and no formatter; match the style of the file you are editing.

## Conventions

- **ESM throughout.** All packages are `"type": "module"`. Relative imports in TypeScript
  carry a `.js` extension (`from './ranking/pass1Ranker.js'`) even though the source is `.ts`.
  Omitting it compiles and then fails at runtime.
- **Tests are `vitest`**, in `packages/*/tests/`, mirroring the `src/` layout.
- **Write the test first.** Every behavioural claim in this repo is expected to have a test
  that fails without the change.
- **Node >= 20**, pnpm 10.

## Things that will burn you

**Ranking changes regress.** `pass2Ranker.ts` scores density as `score / max(1, size / 4)`,
which over-rewards near-empty files. Three separate fixes were attempted — removing the size
division, flooring the divisor, excluding empty files outright — each looked correct in
isolation, each made benchmark results worse, and all three were reverted. The pathology is
still there, deliberately. The signals interact more than they look like they do; if you
change ranking, measure before and after on the benchmark rather than shipping on reasoning.

**Output ordering is load-bearing.** `--stable-order` exists so that repacking an unchanged
repository produces byte-identical output and preserves an LLM's prompt cache. Anything that
varies between runs — a timestamp, a token total, a file count in the preamble — sits ahead of
the file bodies and breaks the cached prefix at byte 1. `omitVolatileMetadata` exists for this
reason. Verify cache stability on *rendered bytes*, never on the file list; checking the list
is exactly what hid a header timestamp once already.

**Discovery must be deterministic.** `fileDiscovery.ts` sorts its results explicitly. Filesystem
enumeration order is not stable across machines, and non-determinism here silently changes
rankings and defeats caching.

**`docs/` is gitignored on purpose.** Specs, plans and scratch analysis stay local. Do not
commit them, and do not "helpfully" un-ignore the directory.

## Benchmarking

`packages/bench` measures, on SWE-bench instances, whether the packed output holds the code a
patch changes, against oracle and random-selection controls, and against Repomix. The method,
the metrics and the published numbers are in [BENCHMARKS.md](BENCHMARKS.md); how to run the
harness is in [packages/bench/README.md](packages/bench/README.md). This file does not
duplicate either, so there is one place to update when they change.

Rules that cost time to learn:

- **Measure ranking and budget changes on the benchmark, not on reasoning.** Run the previous
  commit and the new one on the same instances and compare `patch_ready` and `usable`. Gold-file
  rank and MRR are not a stand-in: a change that raised R@1 from 25.7% to 35.9% made packs worse.
- **The harness is deterministic**, so a difference between two runs on the same instances is a
  real effect of the code. A single instance is a real change, but a small sample; check a held-out
  set (`BENCH_DATASET=princeton-nlp/SWE-bench_Verified`) before believing a gain.
- **Runs are long** (hours for a full pass). Shard across processes and keep shards on different
  checkouts; there is no resume.
- **Results stay local.** `packages/stats` (CSVs) and `packages/.cache` (cloned repos) are
  gitignored, as is `scripts/benchmark-chart.js`. Publish a number by updating BENCHMARKS.md.

## Dogfooding

RepoCode is used to pack RepoCode. To hand this codebase to an agent:

```bash
repocode . --budget 50k --stable-order
```

`--stable-order` keeps the prefix byte-identical across repacks, so an agent re-reading the
bundle between edits keeps its prompt cache.

To inspect ranking instead of packing:

```bash
repocode . --budget 50k --explain
```

`--explain` implies `--dry-run` — it prints the ranking decision for every file and exits
without writing a pack. It is the fastest way to see whether a ranking change did what you
intended. Add `--format json` for a machine-readable report.
