import { describe, it, expect, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import path from 'path';
import { registerPackRepository } from '../src/tools/packRepository.js';

const FIXTURE = path.resolve('packages/core/tests/fixtures/simple-ts');

async function makeClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerPackRepository(server);
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

describe('pack_repository', () => {
  let client: Awaited<ReturnType<typeof makeClient>>;

  afterEach(async () => {
    await client?.close();
  });

  it('returns non-empty output for a fixture directory', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'pack_repository',
      arguments: { path: FIXTURE, format: 'plain' },
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text.length).toBeGreaterThan(50);
  });

  it('noBudget: true includes all fixture files', async () => {
    client = await makeClient();
    const resultWithBudget = await client.callTool({
      name: 'pack_repository',
      arguments: { path: FIXTURE, budget: 1, format: 'plain' },
    });
    const resultNoBudget = await client.callTool({
      name: 'pack_repository',
      arguments: { path: FIXTURE, noBudget: true, format: 'plain' },
    });
    const withBudgetText = (resultWithBudget.content[0] as { text: string }).text;
    const noBudgetText = (resultNoBudget.content[0] as { text: string }).text;
    expect(noBudgetText.length).toBeGreaterThan(withBudgetText.length);
  });

  it('returns an error result for a nonexistent path', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'pack_repository',
      arguments: { path: '/nonexistent/xyz' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('path is not a directory');
  });

  it('returns _meta with token counts and timing', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'pack_repository',
      arguments: { path: FIXTURE, format: 'plain' },
    });
    const meta = (result as any)._meta;
    expect(meta).toBeDefined();
    expect(typeof meta.filesIncluded).toBe('number');
    expect(typeof meta.filesExcluded).toBe('number');
    expect(typeof meta.totalTokens).toBe('number');
    expect(typeof meta.outputTokens).toBe('number');
    expect(meta.outputTokens).toBeGreaterThanOrEqual(meta.totalTokens);
    expect(typeof meta.timingMs).toBe('number');
    expect(typeof meta.budgetUsed).toBe('string');
  });

  it('returns _meta with compression summary', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'pack_repository',
      arguments: { path: FIXTURE, format: 'plain' },
    });
    const meta = (result as any)._meta;
    expect(meta.compressionSummary).toBeDefined();
    expect(typeof meta.compressionSummary.none).toBe('number');
  });

  it('rejects tier3-llm compression without explicit provider in MCP mode', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'pack_repository',
      arguments: { path: FIXTURE, compress: 'tier3-llm' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('tier3-llm');
  });
});
