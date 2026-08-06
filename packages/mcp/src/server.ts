import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerPackRepository } from './tools/packRepository.js';
import { registerSearchFiles } from './tools/searchFiles.js';
import { registerGetFileContext } from './tools/getFileContext.js';
import { registerGetGitContext } from './tools/getGitContext.js';
import { registerGetArchitecture } from './tools/getArchitecture.js';
import { registerListFiles, registerGetFile } from './resources/index.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'repocode',
    version: '1.0.0',
  });
  registerPackRepository(server);
  registerSearchFiles(server);
  registerGetFileContext(server);
  registerGetGitContext(server);
  registerGetArchitecture(server);
  registerListFiles(server);
  registerGetFile(server);
  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
