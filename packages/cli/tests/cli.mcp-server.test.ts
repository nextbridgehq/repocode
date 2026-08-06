import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '../dist/cli.js');

// The MCP stdio transport frames JSON-RPC messages as newline-delimited JSON
// (see @modelcontextprotocol/sdk's shared/stdio.js ReadBuffer/serializeMessage).
// This talks to `repocode mcp-server` directly over its stdio, without pulling
// the SDK's client transport into the CLI package as a test-only dependency.
function sendJsonRpc(proc: ReturnType<typeof spawn>, message: object): void {
  proc.stdin!.write(JSON.stringify(message) + '\n');
}

// 25s, not the original 8s: under this package's full test suite (24 files,
// many spawning their own CLI subprocesses concurrently), the MCP server
// subprocess can take longer than 8s to become ready and respond — confirmed
// by re-running this file in isolation (passes in ~14s, well within 8s of
// actually starting to respond) vs. running the full `repocode` package
// suite together (times out at 8s twice in a row). The `it()` block below
// calls this twice in sequence (initialize, then tools/list), so it carries
// an explicit 60000ms test-level timeout (see its third argument) — well
// above this package's 30s global testTimeout (vitest.config.ts) — so a
// slow-but-not-hung run surfaces this function's own diagnostic message
// instead of vitest's generic "test timed out" error.
function waitForResponse(proc: ReturnType<typeof spawn>, id: number, timeoutMs = 25000): Promise<any> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for response id=${id}. Buffer: ${buffer}`)), timeoutMs);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.id === id) {
          clearTimeout(timer);
          proc.stdout!.off('data', onData);
          resolve(msg);
          return;
        }
      }
    };
    proc.stdout!.on('data', onData);
  });
}

describe('mcp-server subcommand', () => {
  it('speaks MCP over stdio and lists all 5 tools', async () => {
    const proc = spawn('node', [CLI, 'mcp-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      sendJsonRpc(proc, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.0.0' } },
      });
      const initResult = await waitForResponse(proc, 1);
      expect(initResult.result.serverInfo.name).toBe('repocode');

      sendJsonRpc(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });
      sendJsonRpc(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      const toolsResult = await waitForResponse(proc, 2);
      const names = toolsResult.result.tools.map((t: { name: string }) => t.name);
      expect(names).toEqual(expect.arrayContaining([
        'pack_repository', 'search_files', 'get_file_context', 'get_git_context', 'get_architecture',
      ]));
    } finally {
      proc.kill();
    }
  }, 60000);
});

describe('--help / --version', () => {
  it('--help lists the root command and the mcp-server subcommand', () => {
    const proc = spawn('node', [CLI, '--help']);
    return new Promise<void>((resolve, reject) => {
      let out = '';
      proc.stdout.on('data', c => { out += c.toString(); });
      proc.on('close', (code) => {
        try {
          expect(code).toBe(0);
          expect(out).toContain('mcp-server');
          expect(out).toContain('--budget');
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('--version prints the package version', () => {
    const proc = spawn('node', [CLI, '--version']);
    return new Promise<void>((resolve, reject) => {
      let out = '';
      proc.stdout.on('data', c => { out += c.toString(); });
      proc.on('close', (code) => {
        try {
          expect(code).toBe(0);
          expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/);
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });
});
