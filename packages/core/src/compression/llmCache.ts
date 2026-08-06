import path from 'path';
import { ContentHashCache } from '../utils/contentCache.js';
import type { CacheStat } from '../types.js';

export class LLMCache {
  private inner: ContentHashCache<string>;

  constructor(root: string) {
    this.inner = new ContentHashCache<string>(path.join(root, '.repocode'), 'llm-cache');
  }

  get(content: string): string | undefined { return this.inner.get(content); }
  set(content: string, summary: string): void { this.inner.set(content, summary); }
  save(): void { this.inner.save(); }
  /** Hits here are remote API calls (and their cost) that did not happen. */
  stats(): CacheStat { return this.inner.stats(); }
}
