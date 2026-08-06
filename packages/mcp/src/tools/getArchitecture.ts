import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { discoverFiles, estimateFast, generateTree } from '@repocode/core';
import fs from 'fs';
import { z } from 'zod';
import { buildConfigFromParams, validateDirectory } from '../configMapper.js';

export function registerGetArchitecture(server: McpServer): void {
  server.tool(
    'get_architecture',
    'Get a file tree and summary statistics for a repository',
    {
      path: z.string().default('.'),
      maxDepth: z.number().default(4),
    },
    async (params) => {
      const root = params.path === '.' ? process.cwd() : params.path;
      validateDirectory(root);

      const config = await buildConfigFromParams({ path: root });
      const files = await discoverFiles({
        root: config.root,
        include: config.include,
        exclude: config.exclude,
        ignore: config.ignore,
        maxFileSizeBytes: config.maxFileSizeBytes,
      });

      const nonBinary = files.filter(f => !f.isBinary);

      // Filter to maxDepth directory levels (f.path is a forward-slash normalized relative path)
      const filteredFiles = nonBinary.filter(f => {
        return f.path.split('/').length <= params.maxDepth + 1;
      });
      const filteredPaths = filteredFiles.map(f => f.path);

      const tree = generateTree(filteredPaths);

      // Language breakdown (over depth-filtered files)
      const langCounts = new Map<string, number>();
      for (const f of filteredFiles) {
        const lang = f.language ?? 'other';
        langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
      }
      const sorted = [...langCounts.entries()].sort((a, b) => b[1] - a[1]);
      const top3 = sorted.slice(0, 3);
      const otherCount = sorted.slice(3).reduce((s, [, n]) => s + n, 0);
      const langStr = [
        ...top3.map(([lang, n]) => `${lang} (${n})`),
        ...(otherCount > 0 ? [`other (${otherCount})`] : []),
      ].join(', ');

      // Fast token estimate using estimateFast on file content (over depth-filtered files)
      const totalTokens = filteredFiles.reduce((s, f) => {
        try {
          const content = fs.readFileSync(f.absolutePath, 'utf-8');
          return s + estimateFast(content);
        } catch {
          return s;
        }
      }, 0);

      const statsLine = `Files: ${filteredFiles.length}  |  Languages: ${langStr}\nFast token estimate: ~${totalTokens.toLocaleString()} tokens`;
      const output = tree ? `${tree}\n${statsLine}` : statsLine;

      return { content: [{ type: 'text' as const, text: output }] };
    },
  );
}
