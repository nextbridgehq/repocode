import type { LLMConfig } from '../../types.js';
import type { LLMProvider } from './types.js';

export async function resolveProvider(
  config: LLMConfig,
  options?: { requireExplicitConsent?: boolean },
): Promise<LLMProvider> {
  if (options?.requireExplicitConsent && !config.provider) {
    throw new Error(
      '[repocode] error: tier3-llm compression requires an explicit llm.provider ' +
      'in MCP mode because it transmits code to a remote API. Set llm.provider to ' +
      '"openai", "anthropic", "ollama", or "custom" in repocode.config.json, ' +
      'or use compress: "tier2-structural" for local-only compression.'
    );
  }

  const pref = config.provider;

  if (pref === 'openai' || (!pref && process.env.OPENAI_API_KEY?.trim())) {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) throw new Error('[repocode] OPENAI_API_KEY is empty');
    const { OpenAIProvider } = await import('./openai.js');
    return new OpenAIProvider(key, config.model);
  }

  if (pref === 'anthropic' || (!pref && process.env.ANTHROPIC_API_KEY?.trim())) {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) throw new Error('[repocode] ANTHROPIC_API_KEY is empty');
    const { AnthropicProvider } = await import('./anthropic.js');
    return new AnthropicProvider(key, config.model);
  }

  if (pref === 'ollama' || !pref) {
    try {
      const { OllamaProvider } = await import('./ollama.js');
      const p = new OllamaProvider(config.model);
      await p.ping();
      return p;
    } catch {
      if (pref === 'ollama') throw new Error('[repocode] Ollama is not reachable at localhost:11434');
    }
  }

  if (pref === 'custom') {
    const endpoint = config.endpoint ?? process.env.REPOCODE_LLM_ENDPOINT?.trim();
    if (!endpoint) throw new Error('[repocode] --llm-provider custom requires REPOCODE_LLM_ENDPOINT env var');
    const apiKey = process.env.REPOCODE_LLM_KEY?.trim() ?? '';
    const { CustomProvider } = await import('./custom.js');
    return new CustomProvider(endpoint, apiKey, config.model);
  }

  throw new Error(
    '[repocode] No LLM provider available. ' +
    'Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or run Ollama at localhost:11434.'
  );
}
