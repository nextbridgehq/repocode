import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';

async function makeClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

describe('MCP server integration', () => {
  it('lists all 5 tools', async () => {
    const client = await makeClient();
    const result = await client.listTools();
    const names = result.tools.map(t => t.name);
    expect(names).toContain('pack_repository');
    expect(names).toContain('search_files');
    expect(names).toContain('get_file_context');
    expect(names).toContain('get_git_context');
    expect(names).toContain('get_architecture');
    expect(names.length).toBe(5);
  });

  it('lists 2 resource templates', async () => {
    const client = await makeClient();
    const result = await client.listResourceTemplates();
    const uriTemplates = result.resourceTemplates.map(r => r.uriTemplate);
    expect(uriTemplates.some(u => u.includes('/files'))).toBe(true);
    expect(uriTemplates.some(u => u.includes('/file/'))).toBe(true);
    expect(result.resourceTemplates.length).toBe(2);
  });
});
