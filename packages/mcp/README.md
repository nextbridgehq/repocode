# @repocode/mcp

MCP server for RepoCode — expose AI-ready repository context tools to coding assistants via the [Model Context Protocol](https://modelcontextprotocol.io).

Developed by [Nextbridge](https://nextbridge.org).

## Quick Setup

### Claude Desktop

Config file location:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "RepoCode": {
      "command": "npx",
      "args": ["-y", "-p", "@repocode/mcp", "repocode-mcp"]
    }
  }
}
```

Restart Claude Desktop after saving.

### Cursor

Create `.cursor/mcp.json` in your project root (project-scoped) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "RepoCode": {
      "command": "npx",
      "args": ["-y", "-p", "@repocode/mcp", "repocode-mcp"]
    }
  }
}
```

### Windsurf / other editors

Config file: `.codeium/windsurf/mcp_config.json`

```json
{
  "mcpServers": {
    "RepoCode": {
      "command": "npx",
      "args": ["-y", "-p", "@repocode/mcp", "repocode-mcp"]
    }
  }
}
```

### Claude Code (MCP config)

```bash
claude mcp add RepoCode npx -- -y -p @repocode/mcp repocode-mcp
```

## Available Tools

| Tool | Description |
|---|---|
| `pack_repository` | Pack a repository with full ranking, compression, and token budgeting. Returns packed context + `_meta`. |
| `search_files` | Search file contents by regex pattern. Returns matching lines with file paths and line numbers. |
| `get_file_context` | Read a file plus its transitive import graph up to a configurable depth. |
| `get_git_context` | Get recent git diff, log, or branch changes. |
| `get_architecture` | Get a structural overview: directory tree, file counts, language breakdown. |

## Available Resources

| Resource | Description |
|---|---|
| `list_files` | List all discovered files with token counts, ranks, and exclusion reasons. |
| `get_file` | Read a single file's content. |

## Tool Response: `_meta`

The `pack_repository` tool returns a `_meta` object alongside the packed content:

```json
{
  "_meta": {
    "filesIncluded": 42,
    "filesExcluded": 18,
    "totalTokens": 87430,
    "outputTokens": 91200,
    "budgetUsed": "87%",
    "secretsRedacted": 0,
    "compressionSummary": { "none": 30, "tier1": 8, "tier2": 4, "tier3llm": 0, "partial": 0 },
    "timingMs": 1240
  }
}
```

Field reference:

| Field | Type | Description |
|---|---|---|
| `filesIncluded` | `number` | Files included in the output |
| `filesExcluded` | `number` | Files discovered but excluded (budget or filter) |
| `totalTokens` | `number` | Accurate token count of included file content |
| `outputTokens` | `number` | Estimated token count of the full serialized output |
| `budgetUsed` | `string` | Percentage of the token budget consumed (e.g. `"87%"`), or `"unlimited"` when no budget is set |
| `secretsRedacted` | `number` | Number of files containing at least one redacted secret |
| `compressionSummary` | `object` | Count of files at each compression tier |
| `timingMs` | `number` | Pipeline wall time in milliseconds |

## Security

The MCP server applies four security defaults that differ from the CLI:

**No JavaScript config execution** — `repocode.config.js` and `.mjs` files are ignored. Only `repocode.config.json` is loaded. This prevents arbitrary code execution when the server processes untrusted repositories.

**Secret redaction by default** — The default security mode is `redact`. Detected secrets (API keys, tokens, private key headers) are replaced with `[REDACTED]` before any LLM compression call or cache write. Override per-call with the `securityMode` parameter on `pack_repository`.

**Symlink containment** — `get_file` resolves symlinks and rejects any path that escapes the repository root.

**Provider consent gate** — `tier3-llm` compression requires an explicit `llm.provider` in the tool arguments or `repocode.config.json`. If omitted, `pack_repository` returns an error rather than silently calling a remote LLM API.

## Configuration

The server reads `repocode.config.json` from the repository root when `pack_repository` is called with a `path` argument. Tool parameters override config file values — see the `pack_repository` schema for the full list including `securityMode`, `compress`, `budget`, and `format`.

## Links

- [repocode](https://www.npmjs.com/package/repocode) — CLI tool
- [@repocode/core](https://www.npmjs.com/package/@repocode/core) — core library
- [GitHub](https://github.com/nextbridgehq/repocode)
