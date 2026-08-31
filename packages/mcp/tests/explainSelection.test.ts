import { describe, it, expect, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import path from 'path';
import { registerExplainSelection } from '../src/tools/explainSelection.js';
import { registerGetContext } from '../src/tools/getContext.js';

const FIXTURE = path.resolve('packages/core/tests/fixtures/simple-ts');

async function makeClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerExplainSelection(server);
  registerGetContext(server);
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

describe('explain_selection', () => {
  let client: Awaited<ReturnType<typeof makeClient>>;

  afterEach(async () => {
    await client?.close();
  });

  it('returns a compact explanation containing the task', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'explain_selection',
      arguments: { task: 'authentication', path: FIXTURE },
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Task: "authentication"');
    expect(text).toContain('Included');
  });

  it('rejects an empty task', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'explain_selection',
      arguments: { task: '', path: FIXTURE },
    });
    expect(result.isError).toBe(true);
  });

  it('rejects a whitespace-only task', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'explain_selection',
      arguments: { task: '   ', path: FIXTURE },
    });
    expect(result.isError).toBe(true);
  });

  it('rejects a zero budget', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'explain_selection',
      arguments: { task: 'authentication', path: FIXTURE, budget: 0 },
    });
    expect(result.isError).toBe(true);
  });

  it('returns an error result for a nonexistent path', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'explain_selection',
      arguments: { task: 'anything', path: '/nonexistent/xyz' },
    });
    expect(result.isError).toBe(true);
  });

  it('reflects the same file count get_context would select for identical arguments', async () => {
    client = await makeClient();
    const explainResult = await client.callTool({
      name: 'explain_selection',
      arguments: { task: 'authentication', path: FIXTURE, budget: 50000 },
    });
    const contextResult = await client.callTool({
      name: 'get_context',
      arguments: { task: 'authentication', path: FIXTURE, budget: 50000 },
    });
    const explainText = (explainResult.content[0] as { text: string }).text;
    const contextMeta = (contextResult as any)._meta;
    expect(explainText).toContain(`Included (${contextMeta.filesIncluded} files):`);
  });
});
