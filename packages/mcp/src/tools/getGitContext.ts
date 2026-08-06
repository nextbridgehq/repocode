import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { runPipeline } from '@repocode/core';
import { z } from 'zod';
import { spawnSync } from 'child_process';
import { buildConfigFromParams, validateDirectory } from '../configMapper.js';

function isGitRepo(root: string): boolean {
  const result = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: root, encoding: 'utf-8' });
  return result.status === 0;
}

export function registerGetGitContext(server: McpServer): void {
  server.tool(
    'get_git_context',
    'Pack context for recent git changes (diff, staged, branch, or log)',
    {
      path: z.string().default('.'),
      mode: z.enum(['diff', 'staged', 'branch', 'log']).default('diff'),
      base: z.string().optional(),
      branch: z.string().optional(),
      budget: z.number().optional(),
      includeDeps: z.boolean().default(true),
      format: z.enum(['xml', 'markdown', 'plain', 'json']).default('xml'),
    },
    async (params) => {
      const root = params.path === '.' ? process.cwd() : params.path;
      validateDirectory(root);

      if (!isGitRepo(root)) {
        throw new McpError(ErrorCode.InvalidParams, `not a git repository: ${root}`);
      }

      const config = await buildConfigFromParams({
        path: root,
        budget: params.budget,
        format: params.format,
        gitMode: params.mode,
        gitBase: params.base,
        gitBranch: params.branch,
        includeDeps: params.includeDeps,
      });

      const result = await runPipeline(config);
      return { content: [{ type: 'text' as const, text: result.output }] };
    },
  );
}
