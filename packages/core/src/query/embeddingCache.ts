import path from 'path';
import { ContentHashCache } from '../utils/contentCache.js';
import type { CacheStat } from '../types.js';

export class EmbeddingCache {
  private inner: ContentHashCache<number[]>;

  constructor(root: string) {
    this.inner = new ContentHashCache<number[]>(path.join(root, '.repocode'), 'embedding-cache');
  }

  get(text: string): number[] | undefined { return this.inner.get(text); }
  set(text: string, vec: number[]): void { this.inner.set(text, vec); }
  save(): void { this.inner.save(); }
  stats(): CacheStat { return this.inner.stats(); }
}
