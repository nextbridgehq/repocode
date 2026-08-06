import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { discoverFiles } from '@repocode/core';
import path from 'path';
import { buildConfigFromParams } from '../configMapper.js';

export function registerListFiles(server: McpServer): void {
  server.resource(
    'list_files',
    new ResourceTemplate('repocode:///{repoPath}/files', { list: undefined }),
    async (uri, { repoPath }) => {
      const repoRoot = path.resolve(decodeURIComponent(repoPath as string));

      let filePaths: string[];
      try {
        const config = await buildConfigFromParams({ path: repoRoot });
        const files = await discoverFiles({
          root: config.root,
          include: config.include,
          exclude: config.exclude,
          ignore: config.ignore,
          maxFileSizeBytes: config.maxFileSizeBytes,
        });
        filePaths = files.map(f => f.path);
      } catch (err: unknown) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to list files: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/plain',
            text: filePaths.join('\n'),
          },
        ],
      };
    },
  );
}
