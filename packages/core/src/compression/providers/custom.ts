import type { LLMProvider } from './types.js';

export class CustomProvider implements LLMProvider {
  readonly name = 'custom';

  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    private readonly model = 'default',
  ) {}

  async summarize(content: string, filePath: string, systemPrompt: string): Promise<string> {
    const res = await fetch(`${this.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `File: ${filePath}\n\n${content}` },
        ],
        max_tokens: 2048,
      }),
    });
    if (!res.ok) throw new Error(`[repocode] Custom LLM error ${res.status}: ${await res.text()}`);
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0].message.content;
  }
}
