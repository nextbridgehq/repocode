import type { LLMProvider } from './types.js';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';

  constructor(
    private readonly apiKey: string,
    private readonly model = 'claude-haiku-4-5-20251001',
  ) {}

  async summarize(content: string, filePath: string, systemPrompt: string): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: `File: ${filePath}\n\n${content}` }],
      }),
    });
    if (!res.ok) throw new Error(`[repocode] Anthropic API error ${res.status}: ${await res.text()}`);
    const data = await res.json() as { content: Array<{ type: string; text: string }> };
    return data.content.find((b) => b.type === 'text')?.text ?? '';
  }
}
