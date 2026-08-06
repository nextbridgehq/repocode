# RepoCode

Pack almost any repository into a token-budgeted context file for AI coding assistants.

```bash
npx repocode . --budget 100k
```

RepoCode discovers and ranks your files, follows import relationships, and produces XML, Markdown, JSON, or plain text. 

* Produces portable context for ChatGPT, Claude, Gemini, and other AI coding assistants.
* Includes Git diff and PR modes
* Supports watch mode and MCP
* Explains what was included, compressed, or excluded

*Illustrative output:*
```console
$ npx repocode . --budget 50k
✓ Discovered 1,284 files
✓ Ranked 312 candidate files
✓ Included 87 files
✓ Compressed 34 files
✓ Output: repocode-output.xml
✓ Final context: 49,842 tokens
```

```xml
<repository>
  <file path="src/index.ts">...</file>
  <!-- 86 more files -->
</repository>
```
[![CI](https://img.shields.io/github/actions/workflow/status/nextbridgehq/repocode/ci.yml?branch=master&label=CI)](https://github.com/nextbridgehq/repocode/actions)
[![npm version](https://img.shields.io/npm/v/repocode?label=npm)](https://www.npmjs.com/package/repocode)
[![Node.js](https://img.shields.io/node/v/repocode?logo=node.js&logoColor=white)](https://www.npmjs.com/package/repocode)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

[GitHub](https://github.com/nextbridgehq/repocode) · [Issues](https://github.com/nextbridgehq/repocode/issues) · [Releases](https://github.com/nextbridgehq/repocode/releases) · [Changelog](CHANGELOG.md)

---

## Why RepoCode?

AI assistants are only as effective as the context they receive. Many production repositories exceed a practical AI context budget, forcing developers to concatenate files manually or rely on simple glob-based selection that does not account for import relationships or structural importance. 

RepoCode solves this through **intelligent context assembly**:
* **Smart Ranking:** Files are scored by structural importance, import centrality, and recency—not just alphabetical order.
* **Token-aware:** Fits the highest-ranked files into your configured token budget by compressing or trimming lower-priority files, while making inclusion decisions visible.
* **Local by default:** The pipeline runs locally, with built-in secret scanning.
* **Flexible:** Use it as a CLI for one-off prompts, an MCP server for continuous context, or embed the core library in your own tools.

## Four Common Workflows

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

## Packages

| Package | npm | Description |
|---|---|---|
| [`repocode`](packages/cli) | `npm install -g repocode` | CLI — the primary user-facing entry point |
| [`@repocode/core`](packages/core) | `npm install @repocode/core` | Core pipeline library — embed it in your own tools |
| [`@repocode/mcp`](packages/mcp) | `npx -p @repocode/mcp repocode-mcp` | MCP server — exposes context tools to AI assistants |

## Installation

Requires Node.js ≥ 22.

```bash
# CLI, as a one-off
npx repocode .

# CLI, installed globally
npm install -g repocode
```

---

## Core Concepts

*(Note: The following examples assume RepoCode is installed globally; prefix commands with `npx` for one-off use.)*

### Token Budgeting & Compression
RepoCode ensures your output fits a specific token limit. When over budget, it compresses files based on their rank:
- **`tier1`**: Strips comments and whitespace.
- **`tier2`**: Strips function bodies, keeping only structural signatures.
- **`tier3-llm`**: Generates an LLM semantic summary (preserves exports/imports/types, with one-line descriptions).
- **`partial`**: Trims from the bottom of a file when strictly over budget.

*Note: `tier3-llm` sends selected file contents to the configured LLM provider. Before using it with sensitive repositories, select an appropriate security mode such as `redact`, `exclude`, or `fail`.*

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

---

## Configuration

RepoCode reads from `repocode.config.json` in your repository root, allowing you to define defaults, custom instructions, and compression tiers.

Order of precedence: `CLI flags > project config > presets > defaults`.

## Security and Privacy

* **Secret Scanning:** RepoCode scans for secrets by default. In MCP mode, it automatically redacts detected secrets before returning output. 
* **Safe Execution:** The CLI and MCP server block arbitrary execution of repository configuration files (e.g., `.js` configs).
* **Data Privacy:** The packing and ranking pipeline runs locally by default. Features that use an external model provider, including `tier3-llm` and `semantic` query mode, may transmit selected repository data to that provider.
  
  Content returned through MCP or manually provided to a hosted AI assistant is subject to that client's data-handling policy. The `--remote` option retrieves repository data directly from GitHub.
* **Vulnerability Reporting:** Please report security issues to `saadat@nextbridge.com`.

---

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

---

## MCP Server

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

## Architecture and Development

`@repocode/core` owns the entire pipeline. `repocode` (CLI) and `@repocode/mcp` both import it directly without subprocesses.

Editor integrations are planned.

### Contributing
Requires Node.js ≥ 22 and pnpm ≥ 10. See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
git clone https://github.com/nextbridgehq/repocode.git
cd repocode
pnpm install
pnpm -r build
pnpm -r test
```

## License

[MIT](LICENSE) © [Nextbridge](https://www.nextbridge.com)

Built and maintained by **[Nextbridge](https://www.nextbridge.com)** — If RepoCode helped you create an AI-ready snapshot of your codebase with ease, a ⭐ would mean a lot — it helps other developers discover RepoCode.
