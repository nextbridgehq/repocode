import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { traceImports, buildIgnoreFilter, runPipeline } from '@repocode/core';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { buildConfigFromParams, validateDirectory } from '../configMapper.js';

export function registerGetFileContext(server: McpServer): void {
  server.tool(
    'get_file_context',
    'Get a file and all files it imports (transitively) up to a given depth',
    {
      path: z.string().default('.'),
      file: z.string(),
      depth: z.number().default(2),
      budget: z.number().optional(),
      format: z.enum(['xml', 'markdown', 'plain', 'json']).default('xml'),
    },
    async (params) => {
      const root = params.path === '.' ? process.cwd() : params.path;
      validateDirectory(root);

      const absFile = path.resolve(root, params.file);
      if (!fs.existsSync(absFile) || !fs.statSync(absFile).isFile()) {
        throw new McpError(ErrorCode.InvalidParams, `file not found: ${params.file}`);
      }

      const config = await buildConfigFromParams({
        path: root,
        budget: params.budget,
        format: params.format,
      });

      const ignore = await buildIgnoreFilter(root, config.ignore);
      const { dependencies } = await traceImports([params.file], root, ignore, params.depth);

      const result = await runPipeline({
        ...config,
        include: [params.file, ...dependencies],
      });

      return { content: [{ type: 'text' as const, text: result.output }] };
    },
  );
}
