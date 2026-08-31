import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runPipeline } from '@repocode/core';
import { z } from 'zod';
import { buildConfigFromParams, validateDirectory } from '../configMapper.js';

export function registerGetContext(server: McpServer): void {
  server.tool(
    'get_context',
    'Pack the files most relevant to a task into AI-ready context, fit to a token budget. ' +
    'For a narrower slice of a specific file, use get_file_context; for a specific git diff, ' +
    'use get_git_context; for full control over format/compression/security, use pack_repository.',
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

      const compressionSummary = {
        none:     result.included.filter(f => f.compressionLevel === 'none').length,
        tier1:    result.included.filter(f => f.compressionLevel === 'tier1-regex').length,
        tier2:    result.included.filter(f => f.compressionLevel === 'tier2-structural').length,
        tier3llm: result.included.filter(f => f.compressionLevel === 'tier3-llm').length,
        partial:  result.included.filter(f => f.compressionLevel === 'partial').length,
      };

      return {
        content: [{ type: 'text' as const, text: result.output }],
        _meta: {
          filesIncluded:     result.included.length,
          filesExcluded:     result.excluded.length,
          totalTokens:       result.totalTokens,
          outputTokens:      result.outputTokens,
          budgetUsed:        result.budget
            ? `${Math.round((result.totalTokens / result.budget.maxTokens) * 100)}%`
            : 'unlimited',
          secretsRedacted:   result.included.filter(f => f.content.includes('[REDACTED]')).length,
          compressionSummary,
          timingMs:          result.timingMs,
          cacheStats:        result.cacheStats,
        },
      };
    },
  );
}
