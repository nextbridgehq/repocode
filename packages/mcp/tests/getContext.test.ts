import { describe, it, expect, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import path from 'path';
import { registerGetContext } from '../src/tools/getContext.js';

const FIXTURE = path.resolve('packages/core/tests/fixtures/simple-ts');

async function makeClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerGetContext(server);
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

describe('get_context', () => {
  let client: Awaited<ReturnType<typeof makeClient>>;

  afterEach(async () => {
    await client?.close();
  });

  it('returns non-empty output for a task', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'get_context',
      arguments: { task: 'authentication', path: FIXTURE },
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text.length).toBeGreaterThan(50);
  });

  it('rejects an empty task', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'get_context',
      arguments: { task: '', path: FIXTURE },
    });
    expect(result.isError).toBe(true);
  });

  it('rejects a whitespace-only task', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'get_context',
      arguments: { task: '   ', path: FIXTURE },
    });
    expect(result.isError).toBe(true);
  });

  it('rejects a zero budget', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'get_context',
      arguments: { task: 'authentication', path: FIXTURE, budget: 0 },
    });
    expect(result.isError).toBe(true);
  });

  it('returns an error result for a nonexistent path', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'get_context',
      arguments: { task: 'anything', path: '/nonexistent/xyz' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('path is not a directory');
  });

  it('returns _meta with token counts and timing', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'get_context',
      arguments: { task: 'authentication', path: FIXTURE },
    });
    const meta = (result as any)._meta;
    expect(meta).toBeDefined();
    expect(typeof meta.filesIncluded).toBe('number');
    expect(typeof meta.filesExcluded).toBe('number');
    expect(typeof meta.totalTokens).toBe('number');
    expect(typeof meta.outputTokens).toBe('number');
    expect(typeof meta.timingMs).toBe('number');
    expect(typeof meta.budgetUsed).toBe('string');
  });

  it('respects an explicit budget', async () => {
    client = await makeClient();
    // 6105 sits inside a verified stable window (empirically probed: 6098-6111) where the
    // fixture's budget fitter actually has to choose — it fits 2 of the fixture's 4 files
    // (src/index.ts, src/auth/login.ts) rather than 0 (too tiny to fit anything, as budget: 1
    // did previously) or all 4 (which would make this comparison nearly vacuous).
    const resultModerateBudget = await client.callTool({
      name: 'get_context',
      arguments: { task: 'authentication', path: FIXTURE, budget: 6105 },
    });
    const resultBigBudget = await client.callTool({
      name: 'get_context',
      arguments: { task: 'authentication', path: FIXTURE, budget: 100000 },
    });
    const moderateText = (resultModerateBudget.content[0] as { text: string }).text;
    const bigText = (resultBigBudget.content[0] as { text: string }).text;
    expect(bigText.length).toBeGreaterThan(moderateText.length);
  });

  it('selects different files for different tasks under a tight budget', async () => {
    client = await makeClient();
    // 6090 sits inside a verified stable window (empirically probed: 6085-6097) where these two
    // contrasting tasks over the fixture produce disjoint single-file selections: only login.ts
    // is relevant enough to survive for the auth task, and only routes.ts for the api task.
    const authResult = await client.callTool({
      name: 'get_context',
      arguments: { task: 'authentication and login', path: FIXTURE, budget: 6090 },
    });
    const apiResult = await client.callTool({
      name: 'get_context',
      arguments: { task: 'api routes', path: FIXTURE, budget: 6090 },
    });
    const authText = (authResult.content[0] as { text: string }).text;
    const apiText = (apiResult.content[0] as { text: string }).text;

    expect(authText).not.toBe(apiText);
    expect(authText).toContain('login.ts');
    expect(authText).not.toContain('routes.ts');
    expect(apiText).toContain('routes.ts');
    expect(apiText).not.toContain('login.ts');
  });
});
