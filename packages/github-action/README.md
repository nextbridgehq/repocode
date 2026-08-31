# RepoCode Budget Check — GitHub Action

Fails the check if a pull request's diff — plus the files it imports, transitively — doesn't
fit a token budget. Built on `repocode --pr --explain --format json`; see the root
[README](../../README.md) for what RepoCode does.

## Usage

```yaml
name: RepoCode budget check
on: pull_request

jobs:
  budget-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # required -- --pr mode diffs against the base branch
      - uses: actions/setup-node@v4
        with:
          node-version: 20   # required -- repocode needs Node >=20 on PATH for npx to find
      - uses: nextbridgehq/repocode@v0.3.0
        with:
          budget: 100k
```

## Preconditions

- **Trigger context:** intended for `pull_request` / `pull_request_target` workflows, where
  GitHub sets `GITHUB_BASE_REF` automatically. The action resolves that name to `origin/<name>`
  when that ref exists — the only form `actions/checkout` creates — and passes it to the CLI
  explicitly. Outside that context, and without an explicit `base` input, no `--base` flag is
  passed at all — the check silently falls back to the CLI's own default-branch detection rather
  than erroring, so it may not diff against the branch you expect. Pass `base` explicitly if you
  need it to be specific.
- **Fetch depth:** `actions/checkout`'s default shallow clone (`fetch-depth: 1`) does not include
  the base branch's history. Use `fetch-depth: 0` (or another value deep enough to reach the
  merge-base).
- **Node on PATH:** the action shells out to `npx repocode`, which needs Node >=20 already on
  the runner's `PATH`. Add `actions/setup-node@v4` with `node-version: 20` before this step if
  your job doesn't already set one up.

## Inputs

| Input | Default | Description |
|---|---|---|
| `path` | `.` | Directory to analyze — must be the repository root (see below) |
| `budget` | *(repocode's own default)* | Token budget, e.g. `50k` or `100000` |
| `model` | — | Size the budget for a model's context window instead (ignored if `budget` is set) |
| `base` | — | Override the PR base branch |
| `repocode-version` | `latest` | npm dist-tag/version of `repocode` to run |

**`path` must be the repository root.** In `--pr` mode the changed-file list comes from
`git diff --name-status`, whose paths are repository-root-relative. Pointing `path` at a
subdirectory does not scope the check to that subdirectory — every changed file resolves to a
nonexistent location, and the check reports `fits: true` having analyzed nothing. It fails
silently and vacuously rather than erroring, so leave `path` at its default.

Input values are validated before anything is spawned: `budget` must be digits with an
optional `k`/`m` suffix, `repocode-version` must look like an npm version or dist-tag, and
`path`/`model`/`base` are rejected if they contain shell metacharacters. An invalid value
fails the step with a message naming the input.

## Outputs

| Output | Description |
|---|---|
| `fits` | `"true"` or `"false"` |
| `excluded-count` | Number of files excluded for budget-related reasons |
| `total-tokens` | Total tokens in the would-be pack |

All three outputs are set on both a pass and a normal budget-driven failure. If the tool itself
fails to run — a bad input, `repocode` erroring, unparseable output — all three are left unset
and the failure detail goes to the log annotation and the step summary instead; a downstream
step reading `fits` gets an empty string, not `"false"`.

Note: in a workflow `if:` expression, reference the hyphenated outputs with bracket syntax —
`steps.<id>.outputs['excluded-count']`, not `.excluded-count`, which the expression parser
reads as subtraction.

## What counts as "doesn't fit"

Only exclusions caused by the budget: `exceeds-budget`, `exceeds-budget-after-compression`, and
`below-candidate-cut`. Files skipped for unrelated reasons — binary, gitignored, a detected
secret, not found — never fail the check.
