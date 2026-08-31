# Benchmark results

Raw output from two runs of RepoCode's internal SWE-bench Lite harness, published
because outreach posts referencing these numbers should let a skeptical reader check
them, not just cite them.

**The harness itself is not published here.** Per this project's convention, benchmark
tooling stays local — results are regenerated per run and are only meaningful alongside
the exact commit that produced them, so a stale copy of the harness in the public repo
would be worse than no copy. What follows is the exact methodology, so the numbers are
checkable even without the code.

## Dataset

184 instances from SWE-bench Lite, held out (not used to tune ranking), split across two
collection batches that were run separately and are disjoint (no shared `instance_id`):

- `batch-1-n84.csv` — 84 instances
- `batch-2-n100.csv` — 100 instances

Every instance is a real GitHub issue with an accepted fix. The "gold files" for an
instance are the files that fix actually touches.

## What's measured

For each instance, each arm is given the issue and a **50,000-token budget**, and has to
select which files to include. A gold file counts as **retrieved** only if the content
the arm actually delivers for it retains at least **50% of the file's original
character count** (`recall_usable_pct` column). Presence of the file path alone doesn't
count — `recall_path_pct` is kept alongside it as the old, looser metric, so the gap
between the two is visible.

This distinction exists because the first version of the harness scored a path as a hit
regardless of how much content came with it, which meant a stripped function signature
(~11% of a file, in the cases measured) counted identically to the whole file. Every arm
is held to the same content-retention bar and the same denominator (the file's on-disk
size), so a compressing arm's fragment isn't credited against a non-compressing arm's
whole file.

## Arms

| Arm | What it is |
| --- | --- |
| `oracle` | Handed the gold files directly. Should score ~100%; anything less at a given budget means the harness itself has a fault at that budget, not a ranking one. |
| `random` | Files shuffled and taken until the budget fills, no compression. Averaged across 5 seeded draws per instance (seeds 1–5) — a single draw is noise. This is the actual chance floor every ranked arm should be read against. |
| `baseline` | Files taken smallest-first until the budget fills. Excludes vendored/generated paths (`node_modules`, `vendor`, `dist`, `build`, `data`, `fixtures`, etc.) — the same exclusion list RepoCode and Repomix apply by default, so this arm measures picking-by-size against the same file universe, not against having weaker ignore rules. |
| `repomix` | The actual `repomix` CLI. |
| `repocode-base` | The actual `repocode` CLI, default invocation, no `--query`. |
| `repocode-query` | `repocode` CLI with `--query` set to the first line of the issue's problem statement. Only ~34 of the 184 instances have this arm recorded (an incomplete pass) — treat it as a smaller, separate sample, not part of the headline comparison. |

All budgets in this export are **50k tokens**. The harness also runs 25k and 100k, but
this published slice is the 50k rows only, matching the numbers cited in outreach posts.

## Headline numbers (recomputed from these two files, not copied from a prior draft)

Aggregate across all 184 instances, mean `recall_usable_pct`:

| Arm | Mean recall |
| --- | --- |
| oracle | 99.5% |
| repocode-base | 4.9% |
| random | 2.6% |
| repomix | 0.5% |

Restricted to the 10 repositories under ~3,000 files (n=158 of 184 — excludes
`matplotlib/matplotlib` and `django/django`):

| Arm | Mean recall |
| --- | --- |
| repocode-base | 5.7% |
| random | 2.8% |
| repomix | 0.0% |

Per-repository breakdown (`repocode-base` vs `random`, all 184 instances):

| Repository | Files | n | repocode-base | random |
| --- | --- | --- | --- | --- |
| psf/requests | 128 | 6 | 66.7% | 13.3% |
| mwaskom/seaborn | 286 | 4 | 50.0% | 7.5% |
| pylint-dev/pylint | 2,560 | 6 | 16.7% | 3.3% |
| sphinx-doc/sphinx | 1,596 | 16 | 6.3% | 1.3% |
| scikit-learn/scikit-learn | 1,169 | 23 | 4.3% | 1.3% |
| pydata/xarray | 234 | 5 | 0.0% | 4.0% |
| pallets/flask | 251 | 3 | 0.0% | 13.3% |
| pytest-dev/pytest | 418 | 17 | 0.0% | 7.6% |
| sympy/sympy | 1,444 | 77 | 0.0% | 0.9% |
| astropy/astropy | 1,900 | 1 | 0.0% | 0.0% |
| matplotlib/matplotlib | 4,471 | 11 | 0.0% | 1.8% |
| django/django | 6,061 | 15 | 0.0% | 0.7% |

Two repositories (`psf/requests`, `mwaskom/seaborn`) carry most of RepoCode's margin
over random. Excluding them, RepoCode's mean recall over the remaining 174 instances is
**1.7%** against random's **2.1%** (instance-weighted) — RepoCode is not distinguishable
from picking files at random once those two repositories are removed. File count alone
does not predict which repositories work: `pydata/xarray` (234 files) scores 0%,
`sympy/sympy` (1,444 files, n=77) scores 0%, and `psf/requests` (128 files) scores 66.7%.

*A note on scope: an earlier internal draft of this writeup also claimed a specific
significance statistic (a z-score) for the sub-3,000-files comparison. That number could
not be independently reproduced from these two CSVs and has been dropped rather than
republished unverified.*

## What this does and doesn't support

Supports: RepoCode's default ranking beats Repomix's in aggregate on this dataset, and
beats it specifically on the two repositories that dominate the result. It does not
support a general claim that RepoCode's ranking beats random selection — that claim
depends heavily on which two repositories are in the sample.

The one result in this dataset that isn't contingent on which repos happen to be in the
sample: RepoCode's `--stable-order` flag, measured separately (not in these CSVs) on a
40-file repository — editing one file and re-packing takes reusable prompt-cache prefix
from 0% to 100%, because unchanged files keep their position instead of the whole output
reflowing. That's a property of the output format, not of ranking quality, and it holds
regardless of which repository it's run against.
