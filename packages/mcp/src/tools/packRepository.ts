import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runPipeline } from '@repocode/core';
import type { SecurityMode } from '@repocode/core';
import { z } from 'zod';
import { buildConfigFromParams, validateDirectory } from '../configMapper.js';

export function registerPackRepository(server: McpServer): void {
  server.tool(
    'pack_repository',
    'Pack repository files into AI-readable context with intelligent ranking and budget fitting',
    {
      path: z.string().default('.'),
      budget: z.number().optional(),
      noBudget: z.boolean().default(false),
      include: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
      format: z.enum(['xml', 'markdown', 'plain', 'json']).default('xml'),
      gitMode: z.enum(['diff', 'staged', 'branch', 'log', 'range']).optional(),
      gitBase: z.string().optional(),
      gitRange: z.string().optional(),
      graphDepth: z.number().default(2),
      compress: z.enum(['none', 'tier1-regex', 'tier2-structural', 'tier3-llm']).default('none'),
      securityMode: z.enum(['warn', 'exclude', 'redact', 'fail']).optional(),
    },
    async (params) => {
      const root = params.path === '.' ? process.cwd() : params.path;
      validateDirectory(root);
      const config = await buildConfigFromParams({
        ...params,
        securityMode: params.securityMode as SecurityMode | undefined,
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
