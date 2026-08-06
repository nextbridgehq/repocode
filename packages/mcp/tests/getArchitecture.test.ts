import { describe, it, expect, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import path from 'path';
import { registerGetArchitecture } from '../src/tools/getArchitecture.js';

const FIXTURE = path.resolve('packages/core/tests/fixtures/simple-ts');

async function makeClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerGetArchitecture(server);
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

describe('get_architecture', () => {
  let client: Awaited<ReturnType<typeof makeClient>>;

  afterEach(async () => {
    await client?.close();
  });

  it('returns output containing "Files:"', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'get_architecture',
      arguments: { path: FIXTURE },
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Files:');
  });

  it('maxDepth:1 hides files nested 2 or more directories deep', async () => {
    client = await makeClient();
    const shallow = await client.callTool({
      name: 'get_architecture',
      arguments: { path: FIXTURE, maxDepth: 1 },
    });

    client = await makeClient();
    const deep = await client.callTool({
      name: 'get_architecture',
      arguments: { path: FIXTURE, maxDepth: 4 },
    });
    const shallowText = (shallow.content[0] as { text: string }).text;
    const deepText = (deep.content[0] as { text: string }).text;
    // login.ts is at src/auth/login.ts (depth 2) — present in deep, absent in shallow
    expect(deepText).toContain('login.ts');
    expect(shallowText).not.toContain('login.ts');
  });
});
