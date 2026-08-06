import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { discoverFiles } from '@repocode/core';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { buildConfigFromParams, validateDirectory } from '../configMapper.js';

export function registerSearchFiles(server: McpServer): void {
  server.tool(
    'search_files',
    'Find files whose content matches a pattern (regex or literal string)',
    {
      path: z.string().default('.'),
      pattern: z.string(),
      caseSensitive: z.boolean().default(false),
      include: z.array(z.string()).optional(),
      maxResults: z.number().default(50),
    },
    async (params) => {
      const root = path.resolve(params.path);
      validateDirectory(root);

      let regex: RegExp;
      try {
        regex = new RegExp(params.pattern, params.caseSensitive ? 'g' : 'gi');
      } catch (err) {
        throw new McpError(ErrorCode.InvalidParams, `invalid pattern: ${(err as Error).message}`);
      }

      const config = await buildConfigFromParams({ path: root, include: params.include });
      const files = await discoverFiles({
        root: config.root,
        include: params.include ?? config.include,
        exclude: config.exclude,
        ignore: config.ignore,
        maxFileSizeBytes: config.maxFileSizeBytes,
      });

      const nonBinary = files.filter(f => !f.isBinary);
      const matches: Array<{ file: string; line: number; text: string }> = [];

      outer: for (const f of nonBinary) {
        let content: string;
        try {
          content = fs.readFileSync(f.absolutePath, 'utf-8');
        } catch {
          continue;
        }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            matches.push({ file: f.path, line: i + 1, text: lines[i].trim() });
            if (matches.length >= params.maxResults) break outer;
          }
        }
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify(matches) }] };
    },
  );
}
