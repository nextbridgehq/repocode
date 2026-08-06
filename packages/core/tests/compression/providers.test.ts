import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => vi.restoreAllMocks());

describe('resolveProvider', () => {
  it('auto-detects OpenAI when OPENAI_API_KEY is set', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const { resolveProvider } = await import('../../src/compression/providers/factory.js');
    const p = await resolveProvider({});
    expect(p.name).toBe('openai');
    vi.unstubAllEnvs();
  });

  it('auto-detects Anthropic when ANTHROPIC_API_KEY set and no OPENAI_API_KEY', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-ant-key');
    const { resolveProvider } = await import('../../src/compression/providers/factory.js');
    const p = await resolveProvider({});
    expect(p.name).toBe('anthropic');
    vi.unstubAllEnvs();
  });

  it('throws when no provider available', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const { resolveProvider } = await import('../../src/compression/providers/factory.js');
    // Ollama unreachable in test env — mock the ping to throw
    await expect(resolveProvider({ provider: 'custom' })).rejects.toThrow('REPOCODE_LLM_ENDPOINT');
    vi.unstubAllEnvs();
  });
});

describe('resolveProvider — consent gate', () => {
  it('throws when requireExplicitConsent is true and no provider is configured', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('OLLAMA_BASE_URL', '');
    const { resolveProvider } = await import('../../src/compression/providers/factory.js');
    await expect(
      resolveProvider({}, { requireExplicitConsent: true })
    ).rejects.toThrow('tier3-llm compression requires an explicit llm.provider');
    vi.unstubAllEnvs();
  });

  it('does NOT throw the consent error when provider is explicitly set', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-fake');
    const { resolveProvider } = await import('../../src/compression/providers/factory.js');
    await expect(
      resolveProvider({ provider: 'openai' }, { requireExplicitConsent: true })
    ).resolves.toBeDefined();
    vi.unstubAllEnvs();
  });
});
