import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

afterEach(() => vi.restoreAllMocks());

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(__dirname, '..', 'dist', 'cli.js');

describe('--remote mutual exclusion', () => {
  it('rejects --remote combined with a local path argument', () => {
    // Deliberately NOT '.' — Commander's `.argument('[path]', ..., '.')` makes the
    // *default* value '.' indistinguishable from a *user-typed* '.' (confirmed:
    // `processedArgs[0]` is the string '.' in both cases, since Commander has no
    // per-argument equivalent of getOptionValueSource() to tell them apart). So
    // "no path given" and "explicitly typed '.'" are treated as the same request
    // and both pass through — only a genuinely different path is a real conflict
    // worth rejecting.
    const result = spawnSync(process.execPath, [cliEntry, './some-dir', '--remote', 'owner/repo'], { encoding: 'utf-8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--remote cannot be combined with a local path argument');
  });

  it('rejects --remote combined with --diff', () => {
    const result = spawnSync(process.execPath, [cliEntry, '--remote', 'owner/repo', '--diff'], { encoding: 'utf-8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--remote packs a snapshot and has no commit history');
  });

  it('rejects --remote combined with --pr', () => {
    const result = spawnSync(process.execPath, [cliEntry, '--remote', 'owner/repo', '--pr'], { encoding: 'utf-8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--remote packs a snapshot and has no commit history');
  });

  it('rejects --remote combined with --watch', () => {
    const result = spawnSync(process.execPath, [cliEntry, '--remote', 'owner/repo', '--watch'], { encoding: 'utf-8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--remote cannot be combined with --watch');
  });

  it('prints a clean error (not a stack trace) for an invalid --remote value', () => {
    const result = spawnSync(process.execPath, [cliEntry, '--remote', 'not valid', '--stdout'], { encoding: 'utf-8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('[repocode] error: Invalid --remote value');
    expect(result.stderr).not.toContain('at parseRemoteSpec');
  });
});

describe('--stdin mutual exclusion', () => {
  it('rejects --stdin combined with --include', () => {
    const result = spawnSync(process.execPath, [cliEntry, '--stdin', '--include', '*.ts'], {
      input: 'README.md\n',
      encoding: 'utf-8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--stdin cannot be combined with --include or --exclude');
  });

  it('rejects --stdin combined with --exclude', () => {
    const result = spawnSync(process.execPath, [cliEntry, '--stdin', '--exclude', '*.ts'], {
      input: 'README.md\n',
      encoding: 'utf-8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--stdin cannot be combined with --include or --exclude');
  });

  it('rejects --stdin combined with --diff', () => {
    const result = spawnSync(process.execPath, [cliEntry, '--stdin', '--diff'], {
      input: 'README.md\n',
      encoding: 'utf-8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--stdin cannot be combined with a git-history mode');
  });

  it('rejects --stdin combined with --remote', () => {
    const result = spawnSync(process.execPath, [cliEntry, '--stdin', '--remote', 'owner/repo'], {
      input: 'README.md\n',
      encoding: 'utf-8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--stdin cannot be combined with --remote');
  });

  it('rejects --stdin combined with --interactive', () => {
    const result = spawnSync(process.execPath, [cliEntry, '--stdin', '--interactive'], {
      input: 'README.md\n',
      encoding: 'utf-8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--stdin cannot be combined with --interactive');
  });

  it('rejects --stdin combined with --watch', () => {
    const result = spawnSync(process.execPath, [cliEntry, '--stdin', '--watch'], {
      input: 'README.md\n',
      encoding: 'utf-8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--stdin cannot be combined with --watch');
  });
});

describe('buildPackConfig', () => {
  it('maps --query to config.query', async () => {
    const { buildPackConfig } = await import('../src/commands/buildConfig.js');
    const config = await buildPackConfig('.', { query: 'authentication flow' });
    expect(config.query).toBe('authentication flow');
  });

  it('maps --instruction to config.instruction.name', async () => {
    const { buildPackConfig } = await import('../src/commands/buildConfig.js');
    const config = await buildPackConfig('.', { instruction: 'review' });
    expect(config.instruction?.name).toBe('review');
  });

  it('maps --instruction-file to config.instruction.file', async () => {
    const { buildPackConfig } = await import('../src/commands/buildConfig.js');
    const config = await buildPackConfig('.', { instructionFile: 'my-prompt.md' });
    expect(config.instruction?.file).toBe('my-prompt.md');
  });

  it('maps --llm-provider to config.llm.provider', async () => {
    const { buildPackConfig } = await import('../src/commands/buildConfig.js');
    const config = await buildPackConfig('.', { llmProvider: 'anthropic' });
    expect(config.llm?.provider).toBe('anthropic');
  });

  it('maps --compress tier3-llm', async () => {
    const { buildPackConfig } = await import('../src/commands/buildConfig.js');
    const config = await buildPackConfig('.', { compress: 'tier3-llm' });
    expect(config.compress).toBe('tier3-llm');
  });

  it('maps --query-mode to config.queryConfig.mode', async () => {
    const { buildPackConfig } = await import('../src/commands/buildConfig.js');
    const config = await buildPackConfig('.', { queryMode: 'semantic' });
    expect((config.queryConfig as { mode: string } | undefined)?.mode).toBe('semantic');
  });

  it('maps --instruction-text to config.instruction.text', async () => {
    const { buildPackConfig } = await import('../src/commands/buildConfig.js');
    const config = await buildPackConfig('.', { instructionText: 'Be concise.' });
    expect(config.instruction?.text).toBe('Be concise.');
  });

  it('--instruction-file takes precedence over --instruction name', async () => {
    const { buildPackConfig } = await import('../src/commands/buildConfig.js');
    const config = await buildPackConfig('.', { instruction: 'review', instructionFile: 'override.md' });
    expect(config.instruction?.file).toBe('override.md');
    expect(config.instruction?.name).toBeUndefined();
  });

  it('maps --llm-model to config.llm.model', async () => {
    const { buildPackConfig } = await import('../src/commands/buildConfig.js');
    const config = await buildPackConfig('.', { llmModel: 'gpt-4o' });
    expect(config.llm?.model).toBe('gpt-4o');
  });

  it('maps --llm-budget-tokens to config.llm.budgetTokens', async () => {
    const { buildPackConfig } = await import('../src/commands/buildConfig.js');
    const config = await buildPackConfig('.', { llmBudgetTokens: '4000' });
    expect(config.llm?.budgetTokens).toBe(4000);
  });

  it('does not clobber output.format from repocode.config.json when --format is not passed', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cfgprec-'));
    fs.writeFileSync(path.join(tmpDir, 'repocode.config.json'), JSON.stringify({ output: { format: 'markdown' } }));
    const { buildPackConfig } = await import('../src/commands/buildConfig.js');
    const config = await buildPackConfig(tmpDir, {});
    expect(config.output.format).toBe('markdown');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('--format flag still overrides repocode.config.json when explicitly passed', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cfgprec-'));
    fs.writeFileSync(path.join(tmpDir, 'repocode.config.json'), JSON.stringify({ output: { format: 'markdown' } }));
    const { buildPackConfig } = await import('../src/commands/buildConfig.js');
    const config = await buildPackConfig(tmpDir, { format: 'json' });
    expect(config.output.format).toBe('json');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('does not clobber output.preamble from config when --no-preamble is not passed', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cfgprec-'));
    fs.writeFileSync(path.join(tmpDir, 'repocode.config.json'), JSON.stringify({ output: { preamble: false } }));
    const { buildPackConfig } = await import('../src/commands/buildConfig.js');
    const optionSource = () => 'default';
    const config = await buildPackConfig(tmpDir, { preamble: true }, optionSource);
    expect(config.output.preamble).toBe(false);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('--no-preamble overrides config when explicitly passed (source: cli)', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cfgprec-'));
    fs.writeFileSync(path.join(tmpDir, 'repocode.config.json'), JSON.stringify({ output: { preamble: true } }));
    const { buildPackConfig } = await import('../src/commands/buildConfig.js');
    const optionSource = (key: string) => (key === 'preamble' ? 'cli' : 'default');
    const config = await buildPackConfig(tmpDir, { preamble: false }, optionSource);
    expect(config.output.preamble).toBe(false);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('does not clobber security.mode from config when --security-mode is not passed (Commander default is "warn")', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cfgprec-'));
    fs.writeFileSync(path.join(tmpDir, 'repocode.config.json'), JSON.stringify({ security: { enabled: true, mode: 'redact' } }));
    const { buildPackConfig } = await import('../src/commands/buildConfig.js');
    // securityMode carries a Commander-level default of 'warn', so opts.securityMode is always 'warn'
    // even when the flag wasn't typed — optionSource must be consulted to detect that.
    const optionSource = () => 'default';
    const config = await buildPackConfig(tmpDir, { securityMode: 'warn' }, optionSource);
    expect(config.security.mode).toBe('redact');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('--security-mode overrides config when explicitly passed (source: cli)', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cfgprec-'));
    fs.writeFileSync(path.join(tmpDir, 'repocode.config.json'), JSON.stringify({ security: { enabled: true, mode: 'redact' } }));
    const { buildPackConfig } = await import('../src/commands/buildConfig.js');
    const optionSource = (key: string) => (key === 'securityMode' ? 'cli' : 'default');
    const config = await buildPackConfig(tmpDir, { securityMode: 'exclude' }, optionSource);
    expect(config.security.mode).toBe('exclude');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('--no-security still disables security regardless of optionSource for securityMode', async () => {
    const { buildPackConfig } = await import('../src/commands/buildConfig.js');
    const config = await buildPackConfig('.', { security: false, securityMode: 'warn' });
    expect(config.security.enabled).toBe(false);
  });

  it('does not clobber verbose/dryRun/stdout/copy/includeScores when their flags are not passed', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cfgprec-'));
    fs.writeFileSync(path.join(tmpDir, 'repocode.config.json'), JSON.stringify({
      verbose: true, dryRun: true, output: { stdout: true, copy: true, includeScores: true },
    }));
    const { buildPackConfig } = await import('../src/commands/buildConfig.js');
    const config = await buildPackConfig(tmpDir, {});
    expect(config.verbose).toBe(true);
    expect(config.dryRun).toBe(true);
    expect(config.output.stdout).toBe(true);
    expect(config.output.copy).toBe(true);
    expect(config.output.includeScores).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });
});
