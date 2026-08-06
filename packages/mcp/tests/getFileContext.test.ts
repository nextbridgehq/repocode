import { describe, it, expect, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import path from 'path';
import { registerGetFileContext } from '../src/tools/getFileContext.js';

const FIXTURE = path.resolve('packages/core/tests/fixtures/simple-ts');

async function makeClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerGetFileContext(server);
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

describe('get_file_context', () => {
  let client: Awaited<ReturnType<typeof makeClient>>;

  afterEach(async () => {
    await client?.close();
  });

  it('includes the target file in output', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'get_file_context',
      arguments: { path: FIXTURE, file: 'src/index.ts', depth: 0, format: 'plain' },
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('src/index.ts');
  });

  it('includes direct imports at depth 1', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'get_file_context',
      arguments: { path: FIXTURE, file: 'src/index.ts', depth: 1, format: 'plain' },
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('src/auth/login.ts');
  });

  it('returns an error result for a nonexistent file', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'get_file_context',
      arguments: { path: FIXTURE, file: 'src/nonexistent.ts', depth: 1 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('file not found');
  });
});
