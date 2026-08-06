export interface LLMProvider {
  readonly name: string;
  summarize(content: string, filePath: string, systemPrompt: string): Promise<string>;
  embed?(texts: string[]): Promise<number[][]>;
}
