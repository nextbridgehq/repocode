# RepoCode

CLI to analyze, rank, and pack a repository into AI-ready context for LLMs and coding assistants, compressed to fit your token budget.

Developed by [Nextbridge](https://nextbridge.org).

## Install

```bash
npm install -g repocode
# or without installing:
npx repocode .
```

## Quick Start

```bash
repocode .                          # XML output → repocode-output.xml
repocode . --budget 100k            # enforce token budget
repocode . --format markdown        # Markdown output
repocode . --stdout                 # print to stdout
```

## Usage Scenarios

### 1. Pack a repo and send to Claude / ChatGPT

```bash
# Pack the whole repo
repocode . --budget 100k

# Open repocode-output.xml and paste into your AI assistant.
# Or pipe to clipboard:
repocode . --stdout --budget 100k | pbcopy    # macOS
repocode . --stdout --budget 100k | clip      # Windows
```

### 2. Watch mode — keep context fresh while you code

```bash
# Auto-repack every time a file changes
repocode . --watch --budget 100k

# Configure output path:
repocode . --watch --output context.xml
```

The watch command prints a live token count to stderr and rewrites the output file after each repack. Rapid changes within the debounce window are collapsed into one repack; a change arriving mid-repack queues exactly one trailing repack.

### 3. PR review workflow

```bash
# Pack only files changed in this PR
repocode . --pr --budget 80k

# Or pack a specific branch diff vs main
repocode . --branch feature/auth --budget 80k

# Or just staged changes
repocode . --staged
```

### 4. Large codebase with a tight budget

```bash
# Re-rank by task relevance so the most useful files fit
repocode . --query "authentication middleware" --budget 50k

# Use LLM compression to fit more files
repocode . --compress tier3-llm --budget 100k
```

For fine-grained control, use selective compression in `repocode.config.json`:

```json
{
  "compress": {
    "top10": "none",
    "top50": "tier2-structural",
    "rest": "tier3-llm"
  }
}
```

Top 10 files are kept verbatim; files ranked 11–50 have bodies stripped; the rest are LLM-summarised.

### 5. Debug which files were ranked (`--explain`)

```bash
# Print a ranked table of all included files to stderr, then exit
repocode . --explain
```

Output shows each file's rank, score, and per-signal breakdown (structural, depth, keyword, recency). Useful for understanding why certain files were prioritised and tuning your config or `--query`.

## Configuration File

Place `repocode.config.json` in your repository root:

```json
{
  "budget": { "maxTokens": 100000 },
  "output": { "format": "xml" },
  "compress": "partial",
  "exclude": ["*.test.ts", "fixtures/"]
}
```

Run `repocode --init` to generate a starter config.

Selective compression:

```json
{
  "compress": {
    "top10": "none",
    "top50": "tier2-structural",
    "rest": "tier3-llm"
  }
}
```

<details>
<summary><b>All Options</b></summary>

```
Usage: repocode [path] [options]

Options:
  -b, --budget <tokens>              Token budget (e.g. 50k, 100000)
  --no-budget                        Include all files, no budget limit
  -f, --format <format>              Output format: xml|markdown|plain|json  [default: xml]
  -o, --output <file>                Output file path
  --stdout                           Write output to stdout
  --copy                             Copy output to clipboard
  --include <patterns...>            Include glob patterns
  -e, --exclude <patterns...>        Exclude glob patterns
  --no-security                      Disable secret scanning
  --security-mode <mode>             warn|exclude|redact|fail               [default: warn]
  --compress <level>                 none|tier1|tier2|tier3-llm|partial     [default: partial]
  --no-compress                      Disable all compression (alias for --compress none)
  --pin <paths...>                   Always include these files
  --init                             Create a repocode.config.json in the current directory
  --preset <name>                    Load a language preset (e.g. ts-library, py-service)
  --list-presets                     List available presets and exit
  --save-preset <name>               Save current CLI flags as a named preset and exit
  --query <text>                     Re-rank files by relevance to this query
  --query-mode <mode>                keyword|semantic                       [default: keyword]
  --instruction <name>               Prepend a built-in or named instruction
  --instruction-file <path>          Prepend instructions from a file
  --instruction-text <text>          Prepend an inline instruction string
  --list-instructions                List all available instructions and exit
  --llm-provider <provider>          openai|anthropic|ollama|custom
  --llm-model <model>                Override the default model for the chosen provider
  --llm-budget-tokens <n>            Max tokens the LLM may use for compression summaries
  --header <text>                    Custom header text
  --no-preamble                      Omit AI preamble
  --max-file-size <size>             Skip files larger than this (e.g. 500k)
  --dry-run                          Preview without writing output
  --explain                          Print ranked file table to stderr and exit (implies --dry-run)
  --verbose                          Show all excluded files
  --graph-depth <n>                  Import graph depth for tracing        [default: 2]
  --diff                             Working-tree changes (staged + unstaged + untracked)
  --staged                           Staged changes only
  --branch <name>                    Diff of <name> vs auto-detected base
  --log <n>                          Files touched in last n commits
  --range <from..to>                 Files changed in a commit range
  --pr                               Auto-detect PR base from CI
  --base <branch>                    Override base branch for --branch/--pr
  --no-deps                          Disable import tracing in git modes
  --remote <owner/repo>              Pack a GitHub repo without cloning (e.g. owner/repo or a GitHub URL)
  --remote-branch <branch>           Branch to fetch with --remote (default: the repo's default branch)
  --remote-token <token>             GitHub token for --remote (overrides GITHUB_TOKEN env var)
  --stdin                            Read a newline-separated file list from stdin instead of discovering files
  -i, --interactive                  Open TUI for file selection
  -w, --watch                        Auto-repack on file changes
  --profile <name>                   Load named profile (requires -i)
```

Run `repocode mcp-server` to start the MCP server for AI assistants — see [@repocode/mcp](https://www.npmjs.com/package/@repocode/mcp).

</details>

## Links

- [@repocode/core](https://www.npmjs.com/package/@repocode/core) — embed the pipeline in your own tools
- [@repocode/mcp](https://www.npmjs.com/package/@repocode/mcp) — MCP server for AI assistants
- [GitHub](https://github.com/nextbridgehq/repocode)
