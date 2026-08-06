import { describe, it, expect, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import path from 'path';
import { registerSearchFiles } from '../src/tools/searchFiles.js';

const FIXTURE = path.resolve('packages/core/tests/fixtures/simple-ts');

async function makeClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerSearchFiles(server);
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

type SearchMatch = { file: string; line: number; text: string };

describe('search_files', () => {
  let client: Awaited<ReturnType<typeof makeClient>>;

  afterEach(async () => {
    await client?.close();
  });

  it('returns matching lines for a literal string', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'search_files',
      arguments: { path: FIXTURE, pattern: 'login' },
    });
    const matches: SearchMatch[] = JSON.parse((result.content[0] as { text: string }).text);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]).toHaveProperty('file');
    expect(matches[0]).toHaveProperty('line');
    expect(matches[0]).toHaveProperty('text');
  });

  it('is case-insensitive by default', async () => {
    client = await makeClient();
    const lower = await client.callTool({
      name: 'search_files',
      arguments: { path: FIXTURE, pattern: 'login', caseSensitive: false },
    });
    const upper = await client.callTool({
      name: 'search_files',
      arguments: { path: FIXTURE, pattern: 'LOGIN', caseSensitive: false },
    });
    const lowerMatches: SearchMatch[] = JSON.parse((lower.content[0] as { text: string }).text);
    const upperMatches: SearchMatch[] = JSON.parse((upper.content[0] as { text: string }).text);
    expect(lowerMatches.length).toBe(upperMatches.length);
  });

  it('respects maxResults cap', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'search_files',
      arguments: { path: FIXTURE, pattern: 'e', maxResults: 2 },
    });
    const matches: SearchMatch[] = JSON.parse((result.content[0] as { text: string }).text);
    expect(matches.length).toBeLessThanOrEqual(2);
  });

  it('returns empty array when pattern matches nothing', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'search_files',
      arguments: { path: FIXTURE, pattern: 'XYZZY_NOTHING_MATCHES_THIS_12345' },
    });
    const matches: SearchMatch[] = JSON.parse((result.content[0] as { text: string }).text);
    expect(matches).toEqual([]);
  });

  it('returns an error result for an invalid regex', async () => {
    client = await makeClient();
    const result = await client.callTool({
      name: 'search_files',
      arguments: { path: FIXTURE, pattern: '[invalid' },
    });
    expect(result.isError).toBe(true);
  });

  it('returns an error result for a nonexistent path', async () => {
    client = await makeClient();
    const result = await client.callTool({ name: 'search_files', arguments: { path: '/nonexistent/path/xyz', pattern: 'foo' } });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { type: string; text: string }).text).toContain('path is not a directory');
  });
});
