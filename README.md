# RepoCode

Task-scoped context retrieval for coding agents — give it a task and a token budget, and it finds the files that matter.

[![CI](https://img.shields.io/github/actions/workflow/status/nextbridgehq/repocode/ci.yml?branch=main&label=CI)](https://github.com/nextbridgehq/repocode/actions)
[![npm version](https://img.shields.io/npm/v/repocode?label=npm)](https://www.npmjs.com/package/repocode)
[![Node.js](https://img.shields.io/node/v/repocode?logo=node.js&logoColor=white)](https://www.npmjs.com/package/repocode)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

[GitHub](https://github.com/nextbridgehq/repocode) · [Issues](https://github.com/nextbridgehq/repocode/issues) · [Releases](https://github.com/nextbridgehq/repocode/releases) · [Changelog](CHANGELOG.md)

---

## How ranking is evaluated

Ranking is evaluated internally against SWE-bench Lite: given a bug report and a token budget, does the packed output contain the file the accepted fix actually edits, compared against oracle and random-selection controls. Results vary considerably by repository. The harness and raw numbers aren't published here — a specific figure stops being honest the moment the methodology or the code producing it moves on without it, so treat any accuracy claim, ours included, with the skepticism that deserves until you've run it against your own repository.

## Quickstart

```bash
npx repocode . --budget 100k
```

No install, no config file. RepoCode discovers your files, ranks them, and fits the highest-ranked ones into the budget, writing `repocode-output.xml` (`--stdout` to pipe it instead).

Scope it to the task you're actually doing:

```bash
npx repocode . --query "authentication and session handling" --budget 60k   # by topic
npx repocode . --diff --budget 60k                                          # by uncommitted changes
npx repocode . --pr --budget 80k                                            # by PR diff
```

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

## What makes it different

* **Graph traversal, not glob matching.** RepoCode follows import relationships out from the files a query surfaces, so a ranked-high file pulls in the modules it actually depends on — not just whatever else happens to match a pattern.
* **Ranking-to-fit, not truncation.** Every candidate file is scored — structural importance, import centrality, recency, relevance to your query — and lower-ranked files are compressed first to fit the budget, rather than being dropped or cut off mid-file.
* **Cache-stable output.** With `--stable-order`, two packs of an unchanged repository are byte-identical, and a changed file moves to the end instead of shifting everything after it. Measured on a 40-file repo, editing one file went from a 0% to a 100% reusable prompt-cache prefix.

---

<details>
<summary><b>RepoCode vs Repomix</b></summary>

[Repomix](https://github.com/yamadashy/repomix) is the tool most people will be choosing between. It is more mature than this one, and there are things it does better.

| | RepoCode | Repomix |
|---|---|---|
| Task-scoped ranking (`--query`, `--diff`, `--pr`) | **yes** | no |
| Cache-stable output across repacks | **yes** (`--stable-order`) | no |
| Compression tiers | **4**, chosen per file to fit the budget | one `--compress` mode |
| Machine-readable ranking report | **yes** (`--explain --format json`) | no |
| Maturity, users, real-world mileage | new | **years of it** |
| Ecosystem surfaces | CLI, MCP, library | **CLI, MCP, VS Code extension, website, browser extension** |
| Language parsing breadth | 11 languages, hand-written resolvers | **Tree-sitter, far wider coverage** |

The honest summary: RepoCode's edge is task-scoped ranking and cache-stable output — Repomix doesn't do either today. We don't publish head-to-head retrieval numbers, so weigh that claim (or any tool's accuracy claim, including a competitor's) against your own repository rather than a chart. Repomix is the safer choice on every axis that isn't ranking: it is more mature, better supported, reaches more places, and parses more languages.

If you are already using Repomix and it is working, there is no urgent reason to switch.

</details>

<details>
<summary><b>Four Common Workflows</b></summary>

**1. Code Review**
Gather just the files modified in a PR, plus their immediate dependencies:
```bash
npx repocode . --pr --instruction review --budget 80k
```

**2. Bug Hunting**
Focus context around specific domain logic:
```bash
npx repocode . --query "authentication and session handling" --instruction bugfix --budget 60k
```

**3. Preparing for a new AI Chat**
Copy a Markdown representation of a feature branch's changes, including relevant dependencies, directly to your clipboard:
```bash
npx repocode . --branch feature/auth --format markdown --copy
```

**4. Understand Inclusion Decisions**
Inspect how candidate files were ranked and which files would be selected:
```bash
npx repocode . --explain
```

</details>

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
<summary><b>Core Concepts</b></summary>

*(Note: The following examples assume RepoCode is installed globally; prefix commands with `npx` for one-off use.)*

### Token Budgeting & Compression
RepoCode ensures your output fits a specific token limit. When over budget, it compresses files based on their rank, entirely on your machine — the default ceiling (`partial`) never leaves local:
- **`tier1`**: Strips comments and whitespace.
- **`tier2`**: Strips function bodies, keeping only structural signatures.
- **`partial`**: Trims from the bottom of a file when strictly over budget.

One tier is opt-in and not local: **`tier3-llm`** sends selected file contents to your configured LLM provider for a semantic summary (exports/imports/types, with one-line descriptions). It only runs once you've set `--llm-provider` — with none configured, nothing goes over the network no matter what compression ceiling is in effect. Before using it with sensitive repositories, pair it with an appropriate security mode such as `redact`, `exclude`, or `fail`; see [Security and Privacy](#security-and-privacy).

### Git and Query Modes
Pack only the files that matter:
```bash
repocode . --diff          # staged + unstaged changes
repocode . --branch feat   # branch diff vs auto-detected base
repocode . --pr            # auto-detect PR diff in CI
```
Re-rank files by relevance to a task using `--query`:
```bash
repocode --query "database migrations" --budget 50k
```

### Interactive & Watch Mode
- **Interactive TUI:** Run `repocode . -i` to hand-pick files before packing.
- **Watch Mode:** Run `repocode . -w` to keep the context file continuously updated as you type.

### Language Support
Import tracing (for intelligent ranking) currently supports: TypeScript, JavaScript, Python, Go, Rust, Ruby, Java, C, C++, PHP, and C#. All other text files are discovered and ranked by baseline heuristics.

</details>

<details>
<summary><b>Configuration</b></summary>

RepoCode reads from `repocode.config.json` in your repository root, allowing you to define defaults, custom instructions, and compression tiers.

Order of precedence: `CLI flags > project config > presets > defaults`.

</details>

<a id="security-and-privacy"></a>
<details>
<summary><b>Security and Privacy</b></summary>

**No telemetry.** RepoCode collects nothing, phones home nowhere, and has no analytics of any kind. Nothing about your code, your usage, or your machine leaves it unless you explicitly ask for a feature that sends data — and there are exactly three, each named below.

* **Secret Scanning:** RepoCode scans for secrets by default. In MCP mode, it automatically redacts detected secrets before returning output.
* **Safe Execution:** The CLI and MCP server block arbitrary execution of repository configuration files (e.g., `.js` configs).
* **What can leave your machine, and only if you ask for it:**
  * `--llm-provider <name>` — once set, a file too large to fit locally can be sent to that provider for a `tier3-llm` summary. The default compression ceiling already permits tier3-llm; what gates the network call is having a provider configured at all, not the ceiling — so `--llm-provider` is the flag to reach for if you want a guarantee nothing leaves the machine, not `--compress`.
  * `--query-mode semantic` — sends file contents to your configured provider for embeddings.
  * `--remote <owner/repo>` — fetches a repository from GitHub rather than reading a local one.

  Nothing else makes a network request. Everything defaults off, and content returned through MCP or pasted into a hosted assistant is then subject to that client's data-handling policy.
* **Vulnerability Reporting:** Please report security issues to `saadat@nextbridge.com`.

</details>

<details>
<summary><b>Full CLI Reference</b></summary>

```text
Usage: repocode [path] [options]

Output
  -f, --format <format>              Output format: xml|markdown|plain|json
  -o, --output <file>                Output file path (default: repocode-output.<ext>)
  --stdout                           Write output to stdout instead of a file
  --copy                             Copy output to clipboard
  --header <text>                    Custom header text prepended to output
  --no-preamble                      Omit AI preamble from output

Budget & compression
  -b, --budget <tokens>              Token budget (e.g. 50k, 100000)
  --model <name>                     Size the budget for a model's context window
                                     (claude-opus-5, gpt-5.6, gemini-2.5-pro, …)
  --no-budget                        Disable token budget — include all files
  --compress <level>                 Compression ceiling: none|tier1|tier2|tier3-llm|partial
  --no-compress                      Disable all compression (alias for --compress none)
  --pin <paths...>                   Always include these files (bypass candidate cut)
  --max-file-size <size>             Skip files larger than this (e.g. 500k, 2m)

File selection
  --include <patterns...>            Include glob patterns
  -e, --exclude <patterns...>        Exclude glob patterns
  --preset <name>                    Activate a named preset from config or built-in
  --list-presets                     List available presets and exit
  --save-preset <name>               Save current CLI flags as a named preset and exit
  --query <text>                     Re-rank files by relevance to this query
  --query-mode <mode>                Query mode: keyword|semantic
  --graph-depth <n>                  Import graph depth for transitive tracing (default: 2)
  --stdin                            Read a newline-separated file list from stdin

Git modes
  --diff                             Uncommitted working-tree changes (staged + unstaged + untracked)
  --staged                           Staged changes only
  --branch <name>                    Diff of <name> vs auto-detected base branch
  --log <n>                          Files touched in the last n commits
  --range <from..to>                 Files changed in a commit range (e.g. HEAD~3..HEAD)
  --pr                               Auto-detect PR base from CI env or remote HEAD
  --base <branch>                    Override base branch for --branch / --pr
  --no-deps                          Disable import tracing for git modes

Remote repositories
  --remote <owner/repo>              Pack a GitHub repo without cloning
  --remote-branch <branch>           Branch to fetch with --remote (default: repo's default branch)
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

Other
  --init                             Create a repocode.config.json in the current directory
  --dry-run                          Show what would be packed without writing output
  --explain                          Print ranked file table to stderr and exit (implies --dry-run)
  --verbose                          Show all excluded files in summary
  -i, --interactive                  Open interactive TUI for file selection
  -w, --watch                        Watch for file changes and keep the output file up to date
  --profile <name>                   Load named profile in interactive mode (requires -i)

Commands
  mcp-server                         Start the MCP server (same as `npx -p @repocode/mcp repocode-mcp`)
```

</details>

<details>
<summary><b>MCP Server</b></summary>

Exposes RepoCode as [Model Context Protocol](https://modelcontextprotocol.io) tools and resources for AI assistants.

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

</details>

<details>
<summary><b>Architecture and Development</b></summary>

`@repocode/core` owns the entire pipeline. `repocode` (CLI) and `@repocode/mcp` both import it directly without subprocesses.

Editor integrations are planned.

### Contributing
Requires Node.js ≥ 20 and pnpm ≥ 10. See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
git clone https://github.com/nextbridgehq/repocode.git
cd repocode
pnpm install
pnpm -r build
pnpm -r test
```

</details>

---

## License

[MIT](LICENSE) © [Nextbridge](https://www.nextbridge.com)

Built and maintained by **[Nextbridge](https://www.nextbridge.com)** — If RepoCode helped you create an AI-ready snapshot of your codebase with ease, a ⭐ would mean a lot — it helps other developers discover RepoCode.
