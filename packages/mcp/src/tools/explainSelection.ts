import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runPipeline } from '@repocode/core';
import { z } from 'zod';
import { buildConfigFromParams, validateDirectory } from '../configMapper.js';
import { formatCompactExplanation } from '../output/compactExplain.js';

export function registerExplainSelection(server: McpServer): void {
  server.tool(
    'explain_selection',
    'Explain which files get_context would select for a task, and why, without returning ' +
    'their content — a compact, budget-cheap alternative for deciding whether to call ' +
    'get_context at all. "top signal" names the highest-scoring intrinsic file characteristic ' +
    '(filename importance, directory depth, size, extension, or configured ranking keywords) ' +
    'computed before task-based reranking — it does not mean the file textually matched your ' +
    'task. The displayed score reflects the file\'s final rank after reranking.',
    {
      task: z.string()
        .refine(s => s.trim().length > 0, 'task is required')
        .describe('The task or question driving file selection, e.g. "fix the login redirect bug". Non-empty, non-whitespace; used to rank and rerank files by relevance.'),
      budget: z.number().int().positive().optional()
        .describe('Maximum token budget for the selection, as a positive integer. Defaults to 100,000 when omitted.'),
      path: z.string().default('.')
        .describe('Repository root to analyze. Defaults to the current working directory.'),
    },
    async (params) => {
      const root = params.path === '.' ? process.cwd() : params.path;
      validateDirectory(root);
      const config = await buildConfigFromParams({
        path: params.path,
        budget: params.budget,
        query: params.task,
      });
      const result = await runPipeline(config);

      return {
        content: [{ type: 'text' as const, text: formatCompactExplanation(params.task, result) }],
      };
    },
  );
}
