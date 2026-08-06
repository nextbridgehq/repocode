import { describe, it, expect, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { registerGetGitContext } from '../src/tools/getGitContext.js';

async function makeClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerGetGitContext(server);
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

describe('get_git_context', () => {
  let client: Awaited<ReturnType<typeof makeClient>>;

  afterEach(async () => {
    await client?.close();
  });

  it('returns isError for a non-git directory', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-mcp-test-'));
    // Write a dummy file so discoverFiles has something
    fs.writeFileSync(path.join(tmpDir, 'hello.ts'), 'export const x = 1;');

    client = await makeClient();
    const result = await client.callTool({
      name: 'get_git_context',
      arguments: { path: tmpDir, mode: 'diff' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('not a git repository');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
