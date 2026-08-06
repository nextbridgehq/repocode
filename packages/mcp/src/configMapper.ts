import { loadConfig } from '@repocode/core';
import type { RepoCodeConfig, OutputFormat, GitMode, CompressionLevel, SecurityMode } from '@repocode/core';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import path from 'path';
import fs from 'fs';

export function validateDirectory(root: string): void {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new McpError(ErrorCode.InvalidParams, `path is not a directory: ${root}`);
  }
}

const MCP_SECURITY_DEFAULTS = {
  enabled: true,
  mode: 'redact' as const,
};

export async function buildConfigFromParams(
  params: {
    path?: string;
    budget?: number;
    noBudget?: boolean;
    include?: string[];
    exclude?: string[];
    format?: string;
    gitMode?: string;
    gitBase?: string;
    gitBranch?: string;
    gitRange?: string;
    graphDepth?: number;
    compress?: string;
    includeDeps?: boolean;
    securityMode?: SecurityMode;
  }
): Promise<RepoCodeConfig> {
  const root = path.resolve(params.path ?? '.');
  const maxTokens: number | null | undefined = params.noBudget
    ? null
    : params.budget;

  const config = await loadConfig(root, {
    root,
    ...(maxTokens !== undefined ? { budget: { maxTokens } } : {}),
    ...(params.include ? { include: params.include } : {}),
    ...(params.exclude ? { exclude: params.exclude } : {}),
    ...(params.format ? { output: { format: params.format as OutputFormat } } : {}),
    ...(params.gitMode
      ? {
          git: {
            mode: params.gitMode as GitMode,
            base: params.gitBase,
            ...(params.gitBranch ? { branch: params.gitBranch } : {}),
            ...(params.gitRange ? { range: params.gitRange } : {}),
            deps: params.includeDeps ?? true,
          },
        }
      : {}),
    ...(params.graphDepth !== undefined ? { graphDepth: params.graphDepth } : {}),
    ...(params.compress && params.compress !== 'none'
      ? { compress: params.compress as CompressionLevel }
      : {}),
  } as Partial<RepoCodeConfig>, { allowJsConfig: false });

  // Apply MCP security defaults unless caller explicitly set a security mode
  if (!params.securityMode) {
    config.security = { ...config.security, ...MCP_SECURITY_DEFAULTS };
  } else {
    config.security = { enabled: true, mode: params.securityMode };
  }

  // Consent gate: tier3-llm in MCP mode requires explicit provider
  // (prevents silent transmission of code to auto-detected remote APIs)
  const compress = config.compress;
  const needsLLM = typeof compress === 'string'
    ? compress === 'tier3-llm'
    : compress != null && [compress.top10, compress.top50, compress.rest].some(l => l === 'tier3-llm');
  if (needsLLM && !config.llm?.provider) {
    throw new McpError(
      ErrorCode.InvalidParams,
      '[repocode] error: tier3-llm compression requires an explicit llm.provider ' +
      'in MCP mode because it transmits code to a remote API. Set llm.provider to ' +
      '"openai", "anthropic", "ollama", or "custom" in repocode.config.json, ' +
      'or use compress: "tier2-structural" for local-only compression.'
    );
  }

  return config;
}
