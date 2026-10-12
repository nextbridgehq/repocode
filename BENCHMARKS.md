# Benchmarks

How well RepoCode finds the code a task needs, measured on real bug-fix tasks, with the methodology
and the limits stated next to the numbers.

Measured October 2026 on commit `b8bf384`. Every number here comes from one deterministic harness:
rerunning the same build on the same instances reproduced all 80 rows we checked, on all six metrics.

## What is measured

Each task is a [SWE-bench](https://www.swebench.com/) instance: a repository at a fixed commit, a bug
report, and the patch that fixed it. The question is whether the packed context contains the code
that patch changes, within a token budget.

Three metrics, all computed on the text each tool actually delivered, not on file names:

| Metric | Meaning |
|---|---|
| **Usable recall** | A file the patch edits counts only if at least 50% of its content is in the pack. A signature-only stub does not count. |
| **Hunks covered** | The share of the patch's changed regions whose lines are present in the delivered text. |
| **Patch-ready** | 100 for an instance only if every changed region of every file is present, otherwise 0. The strictest of the three. |

An **oracle** arm that delivers only the files the patch edits is the harness check. It must score 100.
Where it does not, the patched file is bigger than the budget on its own, and that instance cannot be
won by any tool at that budget (see "Reading the numbers").

## Arms

| Arm | What it does |
|---|---|
| Baseline | Files in path order until the budget is full. |
| Repomix | `repomix --compress`, in Repomix's own output order, cut when the budget is full. Repomix 1.14.0. |
| Repomix + issue's files | A person skims the issue and passes the files it names (paths, dotted modules, traceback paths) to Repomix `--include`, uncompressed. An issue that names no file falls back to plain Repomix. |
| RepoCode, title | The issue's title as the query. |
| RepoCode, whole issue | The full issue text as the query (`--query-file`). |

Repomix has no ranking or query mode, so the plain Repomix arm measures "pack the repository in file
order and stop at the budget". That is a fair description of what it does, and not a statement about
how well it packs once you have chosen the files, which is what the "+ issue's files" arm is for. That
arm's file selection is our reading of what a person would pass; a different reading would move its
number.

## Results: SWE-bench Lite, 50k-token budget

274 instances (a fixed subset of the 300 in SWE-bench Lite, used throughout development).

| Arm | Usable recall | Hunks covered | Patch-ready | Files in pack |
|---|---|---|---|---|
| Baseline | 0.4 | 0.4 | 0.4 | 812 |
| Repomix | 0.0 | 0.0 | 0.0 | 48 |
| Repomix + issue's files | 25.5 | 25.5 | 25.5 | 22 |
| **RepoCode, title** | **60.9** | **64.1** | **63.5** | 11 |
| **RepoCode, whole issue** | **71.9** | **73.0** | **72.6** | 11 |

Plain Repomix scores zero because the files that matter sit past the budget in its order. On
psf/requests the changed files were at positions 50 to 117 of about 120, and the budget ran out near
file 42. This is a property of path-order packing, not a harness fault.

## Held-out check

Every setting was tuned on the 274 instances above, so we also ran 150 instances from SWE-bench
Verified that are not in SWE-bench Lite, once, with nothing tuned on them (147 ran; three
scikit-learn checkouts failed to set up).

| Arm | Held-out patch-ready | Lite patch-ready |
|---|---|---|
| RepoCode, title | 63.3 | 63.5 |
| RepoCode, whole issue | 70.1 | 72.6 |
| Repomix + issue's files | 25.2 | 25.5 |

Against Repomix + issue's files on the held-out set, RepoCode with the whole issue won 66 instances
and lost none. The title query won 65 and lost 9.

## Other budgets

SWE-bench Lite, 274 instances, patch-ready:

| Budget | Title | Whole issue | Files in pack |
|---|---|---|---|
| 25k | 47.8 | 52.6 | 5 |
| 50k | 63.5 | 72.6 | 11 |
| 100k | 70.4 | 82.1 | 22 |

25k is the weak regime. 44 of the 274 instances have a patched file that alone is larger than 25k
tokens, so they cannot be won at that budget; without them the 25k figures are 53.9 and 58.3. At 25k
the pack holds about five files, and one large top-ranked file takes most of it.

## By repository (50k, patch-ready)

| Repo | Instances | Repomix | Repomix + issue's files | RepoCode, title | RepoCode, whole issue |
|---|---|---|---|---|---|
| astropy | 6 | 0.0 | 83.3 | 83.3 | 100.0 |
| django | 99 | 0.0 | 19.2 | 63.6 | 71.7 |
| matplotlib | 12 | 0.0 | 33.3 | 25.0 | 75.0 |
| seaborn | 4 | 0.0 | 75.0 | 25.0 | 75.0 |
| flask | 3 | 0.0 | 0.0 | 33.3 | 66.7 |
| requests | 6 | 0.0 | 33.3 | 100.0 | 100.0 |
| xarray | 5 | 0.0 | 0.0 | 80.0 | 80.0 |
| pylint | 6 | 0.0 | 33.3 | 66.7 | 66.7 |
| pytest | 17 | 0.0 | 23.5 | 64.7 | 76.5 |
| scikit-learn | 23 | 0.0 | 34.8 | 78.3 | 78.3 |
| sphinx | 16 | 0.0 | 25.0 | 68.8 | 68.8 |
| sympy | 77 | 0.0 | 24.7 | 61.0 | 67.5 |

Repositories with fewer than ten instances are noisy: one instance moves their figure by 10 points or more.

## Reading the numbers

- **These are retrieval results, not fix rates.** Patch-ready means the code the patch changes was in
  the context. It does not mean a model then wrote a correct patch.
- **The metric needs the changed lines to be present.** It does not measure whether the surrounding
  code a model needs to understand them is also there.
- **The query matters.** The whole issue beats the title by 5 to 10 points. An agent has the whole
  issue; a human typing a search has a title.
- **Some instances are unwinnable at a budget.** When a patched file is larger than the budget, no tool
  can deliver it. We report the oracle for exactly this reason, and we give the figures without those
  instances where it matters (25k).
- **No LLM is involved in selection.** The ranking is lexical, structural and import-graph based, so
  results do not depend on a model version.
- **Single-instance changes are real, but the sample is small.** The harness is deterministic, so a
  change that moves an instance did so because of the code. Whether a change generalises is a separate
  question, which the held-out set is meant to answer.

## Reproducing

The harness that produced these numbers is in this repository: [`packages/bench`](packages/bench).
It clones each repository at the instance's base commit, runs each arm at the stated budget, and
scores the delivered text against the patch as described under "What is measured". The datasets are
public (`princeton-nlp/SWE-bench_Lite` and `princeton-nlp/SWE-bench_Verified`), and
[its README](packages/bench/README.md) has the commands.

```bash
pnpm install && pnpm -r build
node packages/bench/dist/index.js --budgets 50000 --arms repocode-query-full,repomix-hinted --limit 20
```

The harness is deterministic, so a rerun on the same build and the same instances should match a
published row exactly. Two things can legitimately differ from the figures above: the Repomix
version (the Repomix arm here used 1.14.0) and the set of instances (the 274 used here are a fixed
subset of Lite's 300; `--limit` takes the first ones in dataset order, not that subset). The raw CSVs
stay local, since a result is only meaningful beside the commit that produced it.

To check RepoCode against your own codebase, the most direct test is the one the tool is built for:

```bash
repocode . --budget 50000 --query "the task, or the whole issue text"
```

and check whether the file you would have edited is in the output.
