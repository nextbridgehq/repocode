import { describe, it, expect } from 'vitest';
import path from 'path';
import { buildConfigFromParams, validateDirectory } from '../src/configMapper.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';

const FIXTURE = path.resolve('packages/core/tests/fixtures/simple-ts');

describe('buildConfigFromParams', () => {
  it('uses resolved path as root', async () => {
    const config = await buildConfigFromParams({ path: FIXTURE });
    expect(config.root).toBe(FIXTURE);
  });

  it('sets maxTokens from budget param', async () => {
    const config = await buildConfigFromParams({ path: FIXTURE, budget: 50000 });
    expect(config.budget.maxTokens).toBe(50000);
  });

  it('sets maxTokens to null when noBudget is true', async () => {
    const config = await buildConfigFromParams({ path: FIXTURE, noBudget: true });
    expect(config.budget.maxTokens).toBeNull();
  });

  it('leaves maxTokens at default when budget is undefined', async () => {
    const config = await buildConfigFromParams({ path: FIXTURE });
    expect(config.budget.maxTokens).toBeTypeOf('number'); // default from DEFAULT_CONFIG
  });

  it('sets output format', async () => {
    const config = await buildConfigFromParams({ path: FIXTURE, format: 'markdown' });
    expect(config.output.format).toBe('markdown');
  });

  it('sets git config when gitMode provided', async () => {
    const config = await buildConfigFromParams({ path: FIXTURE, gitMode: 'diff', includeDeps: false });
    expect(config.git).toBeDefined();
    expect(config.git!.mode).toBe('diff');
    expect(config.git!.deps).toBe(false);
  });

  it('sets include patterns', async () => {
    const config = await buildConfigFromParams({ path: FIXTURE, include: ['**/*.ts'] });
    expect(config.include).toEqual(['**/*.ts']);
  });

  it('sets query from query param', async () => {
    const config = await buildConfigFromParams({ path: FIXTURE, query: 'fix the login bug' });
    expect(config.query).toBe('fix the login bug');
  });

  it('leaves query undefined when not provided', async () => {
    const config = await buildConfigFromParams({ path: FIXTURE });
    expect(config.query).toBeUndefined();
  });
});

describe('validateDirectory', () => {
  it('does not throw for a valid directory', () => {
    expect(() => validateDirectory(FIXTURE)).not.toThrow();
  });

  it('throws McpError for a nonexistent path', () => {
    expect(() => validateDirectory('/nonexistent/path/xyz')).toThrow(McpError);
  });

  it('throws McpError for a file path', async () => {
    const filePath = path.join(FIXTURE, 'package.json');
    expect(() => validateDirectory(filePath)).toThrow(McpError);
  });
});

describe('MCP security defaults', () => {
  it('defaults to redact security mode when securityMode is not set', async () => {
    const config = await buildConfigFromParams({ path: FIXTURE });
    expect(config.security.mode).toBe('redact');
    expect(config.security.enabled).toBe(true);
  });

  it('allows caller to override security mode', async () => {
    const config = await buildConfigFromParams({ path: FIXTURE, securityMode: 'warn' });
    expect(config.security.mode).toBe('warn');
  });

  it('never executes JS config (allowJsConfig is false in MCP)', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const p = await import('path');
    const dir = fs.mkdtempSync(p.join(os.tmpdir(), 'cc-mcp-js-'));
    fs.writeFileSync(p.join(dir, 'repocode.config.js'), 'throw new Error("executed");');
    // Should not throw
    const config = await buildConfigFromParams({ path: dir });
    expect(config.budget.maxTokens).toBe(100_000);
    fs.rmSync(dir, { recursive: true });
  });
});
