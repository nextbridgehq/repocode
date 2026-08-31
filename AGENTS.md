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
| `packages/bench` | gitignored | SWE-bench Lite harness. Not tracked in git — exists locally, methodology stays private. |
| `packages/stats` | gitignored | Raw benchmark result CSVs. Data, not code — local only, never committed. |

The pack pipeline is `packages/core/src/pipeline.ts`, and reading it top to bottom is the
fastest way to understand the system: discover files → build the import graph (its centrality
map is an input to ranking, so it comes first) → rank pass 1 → rank pass 2 → fit to budget →
apply stable ordering → scan for secrets → assemble.

## Commands

```bash
pnpm install
pnpm -r build       # tsc, per package
pnpm -r typecheck   # tsc --noEmit
pnpm -r test        # vitest run — 728 tests
```

CI runs exactly these four plus `node packages/cli/dist/cli.js --version`. There is no linter
and no formatter; match the style of the file you are editing.

## Conventions

- **ESM throughout.** All packages are `"type": "module"`. Relative imports in TypeScript
  carry a `.js` extension (`from './ranking/pass1Ranker.js'`) even though the source is `.ts`.
  Omitting it compiles and then fails at runtime.
- **Tests are `vitest`**, in `packages/*/tests/`, mirroring the `src/` layout.
- **Write the test first.** Every behavioural claim in this repo is expected to have a test
  that fails without the change.
- **Node >= 20**, pnpm 10. (`CONTRIBUTING.md` currently says Node 22; `package.json` engines
  say 20 and CI runs 20. The engines field is authoritative.)

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

`packages/bench` (gitignored, local only — see [Layout](#layout)) measures file recall on
SWE-bench Lite against oracle and random-selection controls. It is not published: the
methodology and the numbers it produces stay off GitHub by design, so this file does not
duplicate them. If you're changing ranking, run the harness locally before and after and
compare against the prior local results — do not ship a ranking change on reasoning alone.
`scripts/benchmark-chart.js` (also gitignored) regenerates a results table from the local CSVs.

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
