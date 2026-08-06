export function estimateFast(content: string): number {
  return Math.ceil(content.length / 4);
}
