# Examples

Runnable versions of the workflows described in the main [README](../README.md). Each script is a single `repocode` invocation — copy the command, or run the script directly from a repository root.

| File | What it does |
|---|---|
| [`code-review.sh`](code-review.sh) | Pack a PR's changed files (plus dependencies) with the built-in `review` instruction |
| [`bug-hunting.sh`](bug-hunting.sh) | Query-scope context around a bug's domain (e.g. "authentication and session handling") with the `bugfix` instruction |
| [`new-ai-chat.sh`](new-ai-chat.sh) | Pack a feature branch's diff as Markdown and copy it straight to the clipboard |
| [`explain-ranking.sh`](explain-ranking.sh) | Dry-run: print the ranked file table without writing output |
| [`repocode.config.json`](repocode.config.json) | A project config with pinned files, ranking keywords, an exclude list, and a stricter security mode |

All commands use `npx repocode`, matching the [Quickstart](../README.md#quickstart) — no global install required. Swap in `repocode` directly if you've installed it globally (see [Installation](../README.md)).
