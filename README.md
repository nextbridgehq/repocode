# RepoCode

**RepoCode builds the smallest useful codebase context for a task — for AI coding agents and LLMs.**

[![CI](https://img.shields.io/github/actions/workflow/status/nextbridgehq/repocode/ci.yml?branch=main&label=CI)](https://github.com/nextbridgehq/repocode/actions)
[![npm version](https://img.shields.io/npm/v/repocode?label=npm)](https://www.npmjs.com/package/repocode)
[![Node.js](https://img.shields.io/node/v/repocode?logo=node.js&logoColor=white)](https://www.npmjs.com/package/repocode)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Most repository-packing tools answer *"how do I package this repository for an AI?"* RepoCode answers a different question: *"which parts of this repository does the AI coding agent actually need for this task?"* Give it a task, a query, a diff, or a pull request, plus a token budget — it finds the relevant code, follows what it depends on, ranks it, and fits the most useful version of it into that budget.

```bash
npx repocode . --query "authentication and session handling" --budget 60k
```

[GitHub](https://github.com/nextbridgehq/repocode) · [Issues](https://github.com/nextbridgehq/repocode/issues) · [Releases](https://github.com/nextbridgehq/repocode/releases) · [Changelog](CHANGELOG.md)

---

## Why RepoCode?

Large repositories contain far more code than a model needs for any one task.

> The goal is not to maximize the amount of code sent to the model. The goal is to maximize the amount of useful code that fits.

That's the whole product, in one sentence — everything below is how it does that.

## What makes it different

* **Graph traversal, not glob matching.** RepoCode follows import relationships out from the files a query surfaces, so a highly ranked file pulls in the modules it actually depends on — not just whatever else happens to match a pattern.
* **Ranking-to-fit, not truncation.** Every candidate file is scored — structural importance, import centrality, recency, relevance to your query — and lower-ranked files are compressed first to fit the budget, rather than being dropped or cut off mid-file.
* **Cache-stable output.** With `--stable-order`, two packs of an unchanged repository are byte-identical, and a changed file moves to the end instead of shifting everything after it. Measured on a 40-file repo, editing one file went from a 0% to a 100% reusable prompt-cache prefix.

## Quick start

No install, no config file:

```bash
npx repocode . --budget 100k
```

RepoCode discovers your files, ranks them, and fits the highest-ranked ones into the budget, writing `repocode-output.xml` (`--stdout` to pipe it instead).

Real output, from running RepoCode on its own repository:

```
$ npx repocode . --budget 50k

  Files:      71 included, 182 excluded
  Tokens:     28,197 / 50,000 (56%)
  Format:     XML → repocode-output.xml

<repocode>
  <preamble>This file contains source code from the repository "repocode" (typescript). It includes 71 files selected by relevance to fit within a 50,000 token budget. Files are ordered by importance. The directory tree shows the structure of included files.</preamble>
  <metadata>...</metadata>
  <directory_structure>...</directory_structure>
  <file path="packages/core/src/types.ts">...</file>
  <!-- 70 more files -->
</repocode>
```

Scope it to the task you're actually doing:

```bash
npx repocode . --query "authentication and session handling" --budget 60k   # by topic
npx repocode . --diff --budget 60k                                          # by uncommitted changes
npx repocode . --pr --budget 80k                                            # by PR diff
npx repocode . --explain                                                    # inspect the ranking
```

RepoCode also ships as a [GitHub Action](#github-action) and an [MCP server](#mcp-server).

---

<details>
<summary><b>RepoCode vs. Repomix</b></summary>

Repomix is an established repository-packing tool, while RepoCode approaches the problem from a different angle: select the code that matters for the task, follow its dependencies, rank it by relevance, and fit the resulting context into a defined token budget.

| | RepoCode | Repomix |
|---|---|---|
| Task-scoped ranking (`--query`, `--diff`, `--pr`) | **yes** | no |
| Cache-stable output across repacks | **yes** (`--stable-order`) | no |
| Compression tiers | **4**, chosen per file to fit the budget | one `--compress` mode |
| Machine-readable ranking report | **yes** (`--explain --format json`) | no |
| Config migration | reads `repomix.config.json` (`--from-repomix`) | — |
| Maturity, users, real-world mileage | new | **years of it** |
| Ecosystem surfaces | CLI, MCP, library | **CLI, MCP, VS Code extension, website, browser extension** |
| Language parsing breadth | 11 languages, hand-written resolvers | **Tree-sitter** |

Repository packers answer *"how do I package this repository for an AI?"* RepoCode answers *"which parts of this repository does the AI actually need for this task?"* That's a different category, not a faster version of the same one.

RepoCode's edge is task-scoped ranking and cache-stable output — Repomix doesn't do either today. Repomix is the safer choice on every axis that isn't ranking: it is more mature, better supported, reaches more places, and parses more languages. If you are already using Repomix and it is working, there is no urgent reason to switch.

**Migrating?** `.repomixignore` is always honoured, with or without any flag. `npx repocode . --from-repomix --budget 60k` translates `repomix.config.json` into RepoCode settings for the run and prints anything it couldn't translate.

</details>

<details>
<summary><b>Common AI coding agent workflows</b></summary>

**Code review** — gather the files modified in a PR, plus their immediate dependencies:
```bash
npx repocode . --pr --instruction review --budget 80k
```

**Bug investigation** — focus an AI coding agent on the relevant part of a large codebase:
```bash
npx repocode . --query "authentication and session handling" --instruction bugfix --budget 60k
```

**Preparing a new AI chat** — copy a Markdown representation of a feature branch's changes, including relevant dependencies, straight to your clipboard:
```bash
npx repocode . --branch feature/auth --format markdown --copy
```

**Understand inclusion decisions** — inspect how candidate files were ranked and which would be selected:
```bash
npx repocode . --explain
```
The ranking report shows the signals behind each file's selection and tags exclusions with reasons like `[below-candidate-cut]`, making the generated context inspectable rather than a black box.

</details>

<details>
<summary><b>Token budgeting, compression, and cache stability</b></summary>

RepoCode treats the token limit as a constraint during selection, not something to clean up after generating a repository dump. Candidate files are ranked first; when the selection exceeds the budget, lower-ranked files are compressed before higher-ranked files are discarded — entirely on your machine. The default ceiling (`partial`) never leaves local:

* **`tier1`** — strips comments and whitespace.
* **`tier2`** — strips function bodies, keeping only structural signatures.
* **`partial`** — trims from the bottom of a file when strictly over budget.

One tier is opt-in and not local: **`tier3-llm`** sends selected file contents to your configured LLM provider for a semantic summary. It only runs once you've set `--llm-provider`; see [Security and privacy](#security-and-privacy).

With `--stable-order`, files are emitted in the order they were emitted last run, with new files appended at the end. An unchanged prefix stays byte-identical, so prompt caches hit across repacks instead of being invalidated by incidental reordering.

</details>

---

<a id="mcp-server"></a>
## MCP server

Exposes RepoCode as [Model Context Protocol](https://modelcontextprotocol.io) tools for AI assistants and coding agents — including `get_context` (pack the files relevant to a task within a token budget) and `explain_selection` (why those files, without returning their content).

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

Full tool list, resources, `_meta` reference, and per-client setup (Claude Desktop, Claude Code, Cursor, Windsurf) in [`packages/mcp/README.md`](packages/mcp/README.md).

<a id="github-action"></a>
## GitHub Action

Fails a PR check when the diff, plus its import-graph dependencies, doesn't fit a token budget — the same ranking and traversal described above, run in CI via `repocode --pr --explain --format json`. Reports through job logs and the step summary, not PR comments.

Setup, the full inputs/outputs table, and preconditions like fetch depth and Node version are in [`packages/github-action/README.md`](packages/github-action/README.md).

---

<details>
<summary><b>Packages</b></summary>

| Package | npm | Description |
|---|---|---|
| [`repocode`](packages/cli) | `npm install -g repocode` | CLI — the primary user-facing entry point |
| [`@repocode/core`](packages/core) | `npm install @repocode/core` | Core pipeline library — embed it in your own tools |
| [`@repocode/mcp`](packages/mcp) | `npx -p @repocode/mcp repocode-mcp` | MCP server — exposes context tools to AI assistants |

</details>

<details>
<summary><b>Installation</b></summary>

Requires Node.js ≥ 20.

```bash
# CLI, as a one-off
npx repocode .

# CLI, installed globally
npm install -g repocode
```

</details>

<details>
<summary><b>Configuration</b></summary>

RepoCode reads `repocode.config.json` from your repository root, letting you define defaults, custom instructions, and compression tiers. Create one with:

```bash
repocode --init
```

Order of precedence: `CLI flags > project config > presets > defaults`.

</details>

<details>
<summary><b>Supported languages</b></summary>

Import tracing — the signal behind dependency-aware ranking — currently supports 11 languages: TypeScript, JavaScript, Python, Go, Rust, Ruby, Java, C, C++, PHP, and C#. All other text files are discovered and ranked by baseline heuristics.

</details>

<a id="security-and-privacy"></a>
<details>
<summary><b>Security and privacy</b></summary>

**Privacy-first.** RepoCode has no telemetry and runs locally by default. Code only leaves your machine when you explicitly configure one of exactly three features:

* `--llm-provider <name>` — a file too large to fit locally can be sent to that provider for a `tier3-llm` compression summary. The default compression ceiling already permits tier3-llm; what gates the network call is having a provider configured at all, not the ceiling — so `--llm-provider` is the flag to reach for if you want a guarantee nothing leaves the machine.
* `--query-mode semantic` — sends file contents to your configured provider for embeddings.
* `--remote <owner/repo>` — fetches a repository from GitHub rather than reading a local one.

Nothing else makes a network request. Content returned through MCP or pasted into a hosted assistant is then subject to that client's own data-handling policy.

Also: secret scanning runs by default (`--security-mode warn|exclude|redact|fail`; MCP mode redacts automatically), and the CLI and MCP server both block arbitrary execution of repository configuration files. Report security issues to `saadat@nextbridge.com`.

</details>

<details>
<summary><b>CLI reference</b></summary>

RepoCode supports task queries, Git/PR context, token budgets, compression, ranking explanations, remote repositories, security controls, and more.

```bash
repocode --help            # 12 flags that cover most workflows
repocode --help-advanced   # everything else
```

```text
Usage: repocode [path] [options]

  -b, --budget <tokens>              Token budget (e.g. 50k, 100000)
  --model <name>                     Size the budget for a model's context window, leaving
                                     room for its reply (claude-opus-5, gpt-5.6,
                                     gemini-2.5-pro, …). --budget wins if both are given
  -f, --format <format>              Output format: xml|markdown|plain|json
  -o, --output <file>                Output file path (default: repocode-output.<ext>)
  --stdout                           Write output to stdout instead of a file
  --include <patterns...>            Include glob patterns
  -e, --exclude <patterns...>        Exclude glob patterns
  --compress <level>                 Compression ceiling: none|tier1|tier2|tier3-llm|partial
                                     (default: partial)
  --stable-order                     Emit files in the order they were emitted last run,
                                     appending new ones at the end, so an unchanged prefix
                                     stays byte-identical and prompt caches hit across repacks
  --explain                          Print ranked file table to stderr and exit (implies --dry-run)
  --diff                             Uncommitted working-tree changes (staged + unstaged + untracked)
  --query <text>                     Re-rank files by relevance to this query
```

<details>
<summary><b>Advanced flags (<code>--help-advanced</code>)</b></summary>

```text
Output
  --copy                             Copy output to clipboard
  --header <text>                    Custom header text prepended to output
  --no-preamble                      Omit AI preamble from output

Budget & compression
  --no-budget                        Disable token budget — include all files
  --no-compress                      Disable all compression (alias for --compress none)
  --pin <paths...>                   Always include these files (bypass candidate cut)
  --max-file-size <size>             Skip files larger than this (e.g. 500k, 2m)
  --max-candidates <n>               Cap how many ranked files are considered for packing.
                                     Fewer candidates means more budget per file, so each is
                                     included at higher fidelity; more means broader but
                                     shallower coverage

File selection
  --preset <name>                    Activate a named preset from config or built-in
  --list-presets                     List available presets and exit
  --save-preset <name>               Save current CLI flags as a named preset and exit
  --query-mode <mode>                Query mode: keyword|semantic (default: keyword)
  --graph-depth <n>                  Import graph depth for transitive tracing and centrality
                                     scoring (default: 2; set to 0 to disable)
  --stdin                            Read a newline-separated file list from stdin instead of
                                     discovering files

Git modes
  --staged                           Staged changes only
  --branch <name>                    Diff of <name> vs auto-detected base branch
  --log <n>                          Files touched in the last n commits
  --range <from..to>                 Files changed in a commit range (e.g. HEAD~3..HEAD)
  --pr                               Auto-detect PR base from CI env or remote HEAD
  --base <branch>                    Override base branch for --branch / --pr
  --no-deps                          Disable import tracing for git modes (default: enabled)

Remote repositories
  --remote <owner/repo>              Pack a GitHub repo without cloning (owner/repo or a URL)
  --remote-branch <branch>           Branch to fetch with --remote (default: repo's default)
  --remote-token <token>             GitHub token for --remote (overrides GITHUB_TOKEN env var)

Instructions
  --instruction <name>               Use a named instruction from the library
  --instruction-file <path>          Include instruction text from this file
  --instruction-text <text>          Use literal text as the instruction
  --list-instructions                List available instructions and exit

LLM compression
  --llm-provider <name>              openai|anthropic|ollama|custom
  --llm-model <name>                 Model name for the LLM provider
  --llm-budget-tokens <n>            Max tokens per file for LLM compression (default: 8000)

Security
  --no-security                      Disable secret scanning
  --security-mode <mode>             warn|exclude|redact|fail (default: warn)

Interop & config
  --from-repomix                     Translate an existing repomix.config.json into RepoCode
                                     settings and use them for this run. Prints what could not
                                     be translated. .repomixignore is always honoured, with or
                                     without this flag
  --init                             Create a repocode.config.json in the current directory

Other
  --dry-run                          Show what would be packed without writing output
  --verbose                          Show all excluded files in summary
  -i, --interactive                  Open interactive TUI for file selection
  -w, --watch                        Watch for file changes and keep the output file up to date
  --profile <name>                   Load named profile in interactive mode (requires -i)
  --help-advanced                    Show every flag, including the ones --help omits

Commands
  mcp-server                         Start the MCP server (same as `npx -p @repocode/mcp repocode-mcp`)
```

</details>

</details>

## How ranking is evaluated

Ranking is evaluated internally against SWE-bench Lite: given a bug report and a token budget, does the packed output contain the file the accepted fix actually edits, against oracle and random-selection controls. We don't publish a single retrieval-accuracy number, because results vary considerably by repository and task — the evaluation harness is what's meant to be trusted, not a headline figure, so run it against your own codebase rather than taking any tool's accuracy claim (ours included) on faith.

## FAQ

**`--pr` says "Would include: 0 files" — is it broken?**
Not necessarily. `--pr` needs a base to diff against, which it gets from CI environment variables or the repository's configured git remote. Run it locally with no remote configured and outside CI, and there's nothing to detect a PR diff from. Pass `--base <branch>` (or use `--branch <name>` instead) to specify the comparison explicitly.

**A file I expected is missing from the output — where did it go?**
Run `--explain` to print the full ranked candidate list and why each file was or wasn't included — it tags excluded files with reasons like `[below-candidate-cut]`. Common causes: it ranked below the budget cut line, or it's excluded by `.gitignore`, a default ignore pattern, or `--exclude`. Use `--pin <path>` to force-include a specific file regardless of rank.

**Does `--compress tier3-llm` or `--llm-provider` send my code anywhere?**
Only `--llm-provider` gates a network call. The compression ceiling permits `tier3-llm` by default, but nothing leaves your machine until you've actually configured a provider. See [Security and privacy](#security-and-privacy).

**`npx repocode .` is taking minutes, not seconds — is that normal?**
It can be, and it's worth checking before assuming it's stuck. On one large monorepo we measured a plain `--dry-run` at over 4 minutes of wall time against under 1 second of CPU time — the bottleneck was filesystem discovery, not ranking or compression. Check that your biggest directories (`node_modules`, build output) are covered by `.gitignore` or `--exclude`, and consider `--max-file-size` for large generated files.

<details>
<summary>More FAQ — config precedence, JS configs, secret-detection modes</summary>

**I changed `repocode.config.json` and nothing happened.**
Precedence is `CLI flags > project config > presets > defaults` — a flag on the command line always overrides the file. Unrecognized top-level keys log an `unknown config key` warning to stderr and are dropped, while the rest of the file still applies.

**Can I use `repocode.config.js` instead of JSON?**
Only in CLI mode, and only if you explicitly opt in — by default RepoCode blocks execution of JS config files as a security measure. Stick to `repocode.config.json` unless you specifically need computed config.

**What happens when a secret is detected in a file?**
Depends on `--security-mode`: `warn` (default) flags it but still includes the file, `exclude` drops the file entirely, `redact` masks the detected secret and includes the rest of the file, `fail` aborts the run. In MCP mode, detected secrets are redacted automatically before output is returned to the client.

</details>

<details>
<summary><b>Architecture and development</b></summary>

`@repocode/core` owns the entire pipeline. `repocode` (CLI) and `@repocode/mcp` both import it directly, without subprocesses. Editor integrations are planned.

Requires Node.js ≥ 20 and pnpm ≥ 10. See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
git clone https://github.com/nextbridgehq/repocode.git
cd repocode
pnpm install
pnpm -r build
pnpm -r test
```

</details>

## License

[MIT](LICENSE) © [Nextbridge](https://www.nextbridge.com)

Built and maintained by **[Nextbridge](https://www.nextbridge.com)** — If RepoCode helped you create an AI-ready snapshot of your codebase with ease, a ⭐ would mean a lot — it helps other developers discover RepoCode.
