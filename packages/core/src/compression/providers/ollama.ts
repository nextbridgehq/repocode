import type { LLMProvider } from './types.js';

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  private readonly baseUrl: string;

  constructor(
    private readonly model = 'llama3.2',
    baseUrl = 'http://localhost:11434',
  ) {
    this.baseUrl = baseUrl;
  }

  async ping(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error('[repocode] Ollama not reachable');
  }

  async summarize(content: string, filePath: string, systemPrompt: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `File: ${filePath}\n\n${content}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`[repocode] Ollama error ${res.status}`);
    const data = await res.json() as { message: { content: string } };
    return data.message.content;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      const res = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
      });
      if (!res.ok) throw new Error(`[repocode] Ollama embed error ${res.status}`);
      const data = await res.json() as { embedding: number[] };
      results.push(data.embedding);
    }
    return results;
  }
}
