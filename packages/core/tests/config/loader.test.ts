import { describe, it, expect, vi } from 'vitest';
import { loadConfig } from '../../src/config/loader.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

describe('loadConfig', () => {
  it('returns defaults when no config file exists', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cfg-'));
    const cfg = await loadConfig(dir, {});
    expect(cfg.budget.maxTokens).toBe(100_000);
    expect(cfg.output.format).toBe('xml');
    fs.rmSync(dir, { recursive: true });
  });

  it('merges CLI overrides over defaults', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cfg-'));
    const cfg = await loadConfig(dir, { budget: { maxTokens: 50_000 } });
    expect(cfg.budget.maxTokens).toBe(50_000);
    fs.rmSync(dir, { recursive: true });
  });

  it('reads repocode.config.json if present', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cfg-'));
    fs.writeFileSync(
      path.join(dir, 'repocode.config.json'),
      JSON.stringify({ output: { format: 'markdown' } })
    );
    const cfg = await loadConfig(dir, {});
    expect(cfg.output.format).toBe('markdown');
    fs.rmSync(dir, { recursive: true });
  });

  it('warns on unknown top-level keys and still applies valid keys', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-loader-'));
    fs.writeFileSync(
      path.join(root, 'repocode.config.json'),
      JSON.stringify({ buget: 100000, budget: { maxTokens: 50000 } })
    );

    const messages: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((msg: string | Uint8Array) => {
      messages.push(String(msg));
      return true;
    });

    const config = await loadConfig(root, {});
    stderrSpy.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });

    const warnMessages = messages.filter(msg => msg.includes('unknown config key'));
    expect(warnMessages).toHaveLength(1);
    expect(warnMessages[0]).toContain('"buget"');
    expect(warnMessages[0]).toContain('repocode.config.json');

    // Valid key is still applied
    expect(config.budget.maxTokens).toBe(50000);
  });

  it('skips JS config and warns when allowJsConfig is false', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-jsguard-'));
    // Write a JS config that would crash the process if imported
    fs.writeFileSync(path.join(dir, 'repocode.config.js'), 'throw new Error("should not be imported");');
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const cfg = await loadConfig(dir, {}, { allowJsConfig: false });
    expect(cfg.budget.maxTokens).toBe(100_000); // defaults — file was not executed
    const warned = spy.mock.calls.some(c => String(c[0]).includes('JS config execution is disabled'));
    expect(warned).toBe(true);
    spy.mockRestore();
    fs.rmSync(dir, { recursive: true });
  });

  it('loads JS config only when allowJsConfig is explicitly true', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-jsload-'));
    fs.writeFileSync(
      path.join(dir, 'repocode.config.js'),
      'export default { budget: { maxTokens: 77777 } };'
    );
    const cfg = await loadConfig(dir, {}, { allowJsConfig: true });
    expect(cfg.budget.maxTokens).toBe(77_777);
    fs.rmSync(dir, { recursive: true });
  });

  it('does NOT execute JS config when allowJsConfig is omitted (secure default)', async () => {
    // Executing repocode.config.js runs arbitrary code from the target
    // directory, so the default must be deny — a caller that forgets to pass
    // allowJsConfig must not silently get code execution.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-jsdefault-'));
    fs.writeFileSync(
      path.join(dir, 'repocode.config.js'),
      'throw new Error("should not be imported");'
    );
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const cfg = await loadConfig(dir, {});

    expect(cfg.budget.maxTokens).toBe(100_000); // defaults — file was not executed
    const warned = spy.mock.calls.some(c =>
      String(c[0]).includes('JS config execution is disabled')
    );
    expect(warned).toBe(true);
    spy.mockRestore();
    fs.rmSync(dir, { recursive: true });
  });
});
