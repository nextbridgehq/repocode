import { describe, it, expect, vi } from 'vitest';
import { scanForSecrets } from '../../src/security/secretScanner.js';

let loadCallCount = 0;
vi.mock('@secretlint/config-loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@secretlint/config-loader')>();
  return {
    ...actual,
    loadPackagesFromConfigDescriptor: (...args: Parameters<typeof actual.loadPackagesFromConfigDescriptor>) => {
      loadCallCount++;
      return actual.loadPackagesFromConfigDescriptor(...args);
    },
  };
});

describe('scanForSecrets', () => {
  it('detects AWS access key', async () => {
    const key = 'AKIA' + 'Z'.repeat(16);
    const content = `const key = "${key}";`;
    const result = await scanForSecrets('config.ts', content);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].patternName).toContain('aws');
  });

  it('detects private key header', async () => {
    const body = 'MI' + 'A'.repeat(120);
    const content = `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----\n`;
    const result = await scanForSecrets('key.pem', content);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].patternName).toContain('privatekey');
  });

  it('returns empty findings for clean content', async () => {
    const content = 'const greeting = "hello world";';
    const result = await scanForSecrets('hello.ts', content);
    expect(result.findings).toHaveLength(0);
  });

  it('redacts matched values when mode is redact', async () => {
    const key = 'AKIA' + 'Z'.repeat(16);
    const content = key;
    const result = await scanForSecrets('f.ts', content, 'redact');
    expect(result.redactedContent).not.toContain(key);
    expect(result.redactedContent).toContain('[REDACTED]');
  });

  it('redacts multiple findings without corrupting offsets', async () => {
    const key = 'AKIA' + 'Z'.repeat(16);
    const body = 'MI' + 'A'.repeat(120);
    const content = `const key = "${key}";\n-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----\n`;
    const result = await scanForSecrets('f.ts', content, 'redact');
    expect(result.findings.length).toBeGreaterThanOrEqual(2);
    expect(result.redactedContent).not.toContain(key);
    expect(result.redactedContent).not.toContain(body);
    expect((result.redactedContent!.match(/\[REDACTED\]/g) ?? []).length).toBe(result.findings.length);
  });

  it('derives patternName from a GitHub token ruleId', async () => {
    const token = 'ghp_' + 'A'.repeat(36);
    const content = `const token = "${token}";`;
    const result = await scanForSecrets('config.ts', content);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.some(f => f.patternName === 'github')).toBe(true);
  });

  it('builds the Secretlint config only once across multiple calls', async () => {
    const before = loadCallCount;
    await scanForSecrets('a.ts', 'const x = 1;');
    await scanForSecrets('b.ts', 'const y = 2;');
    // The module-level cache in secretScanner.ts was already primed by earlier
    // tests in this file (module-level state persists across tests in one file),
    // so loadCallCount should not increase from these two calls.
    expect(loadCallCount).toBe(before);
  });
});
