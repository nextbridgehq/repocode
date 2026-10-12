# @repocode/bench

The harness behind the numbers in [BENCHMARKS.md](../../BENCHMARKS.md). It is `private` and is
never published to npm.

For each [SWE-bench](https://www.swebench.com/) instance it checks out the repository at the
instance's base commit, runs each arm at a token budget, and scores what each arm delivered
against the instance's patch.

## Run it

```bash
pnpm install
pnpm -r build    # the arms shell out to the built CLI at packages/cli/dist/cli.js
node packages/bench/dist/index.js --budgets 50000 --arms repocode-query,repocode-query-full --limit 5
```

You need `git` and network access: the dataset comes from the Hugging Face datasets server and each
repository is cloned from GitHub into `packages/.cache/repos/` (several GB for the full set).

Results are written to `packages/stats/results_<n>instances_<timestamp>.csv`, one row per instance
and arm, with a fresh file per run. Both directories are gitignored.

### Options

| Option | Meaning |
|---|---|
| `--limit <n>` | Run only the first `n` instances. |
| `--budgets <list>` | Comma-separated token budgets. Default `25000,50000,100000`. |
| `--arms <list>` | Which arms to run. The oracle always runs, as the harness check. |
| `--ids-from <csv>` | Run only the instance ids in the first column of this CSV (header row skipped, LF line endings). |

| Environment | Meaning |
|---|---|
| `BENCH_DATASET` | Hugging Face dataset id. Default `princeton-nlp/SWE-bench_Lite`. Use `princeton-nlp/SWE-bench_Verified` for a held-out set. |
| `REPOCODE_CLI` | Path to the CLI to benchmark. Default `packages/cli/dist/cli.js`. |

### Arms

| Arm | What it does |
|---|---|
| `oracle` | Delivers only the files the patch edits. Must score 100; below that the gold file does not fit the budget. |
| `random` | The chance line: random files up to the budget. |
| `baseline` | Files in path order until the budget is full. |
| `repomix` | `repomix --compress`, in its own order, cut at the budget. Runs `npx repomix@1.14.0` (the version the published numbers used; it is downloaded on first use and is not a dependency of this package). |
| `repomix-hinted` | Repomix `--include` the files the issue names, uncompressed. Falls back to `repomix` if none are named. |
| `repocode-base` | RepoCode with no query. |
| `repocode-query` | RepoCode with the issue title as the query. |
| `repocode-query-full` | RepoCode with the whole issue as the query. |

## Metrics

Every arm is scored on the text it delivered, identically.

- `recall_path_pct`: the file's path is in the pack, whatever fraction of it came with it.
- `recall_usable_pct`: at least 50% of the file's content is in the pack.
- `hunks_covered_pct`: the share of the patch's hunks whose changed lines are present in the delivered text.
- `patch_ready`: 100 only if every hunk of every file is covered.

## Notes

- **The benchmark is deterministic.** Rerunning the same build on the same instances gives identical
  rows. If two runs differ, something changed: the code, the cached checkout, or the Repomix version.
- **Runs are long and have no resume.** A full pass is hours. Split the instances across shards (one
  `--ids-from` file per process) and keep shards on different repository checkouts, since the arms
  write artifacts into the checkout they run in.
- **Compare like with like.** A ranking change should be measured against a run of the previous commit
  on the same instances, and judged on `patch_ready` and `usable`, not on rank metrics alone: gold-file
  rank at 1 and MRR improved in an experiment that made the packs worse.
- **Some instances are unwinnable at a budget.** The oracle shows which: where it is below 100, the
  patched file is larger than the budget.

## Tests

```bash
pnpm --filter @repocode/bench test
```

The tests cover scoring, the arms' selection logic and the dataset helpers. They need `git` (some
create throwaway repositories in a temp directory) but do not clone anything or use the network.
