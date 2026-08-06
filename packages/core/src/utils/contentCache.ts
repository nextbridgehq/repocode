import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { CacheStat } from '../types.js';

interface CacheEntry<T> { hash: string; value: T; }

export class ContentHashCache<T> {
  private data: Record<string, CacheEntry<T>> = {};
  private dirty = false;
  private hits = 0;
  private misses = 0;
  private writes = 0;
  private bytesFromCache = 0;
  private readonly filePath: string;

  constructor(cacheDir: string, name: string) {
    this.filePath = path.join(cacheDir, `${name}.json`);
    if (fs.existsSync(this.filePath)) {
      try { this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')); } catch { /* corrupt cache: start fresh */ }
    }
  }

  get(content: string): T | undefined {
    const h = this.hash(content);
    const entry = this.data[h];
    if (entry?.hash === h) {
      this.hits++;
      this.bytesFromCache += Buffer.byteLength(content, 'utf-8');
      return entry.value;
    }
    this.misses++;
    return undefined;
  }

  stats(): CacheStat {
    return {
      hits: this.hits,
      misses: this.misses,
      writes: this.writes,
      bytesFromCache: this.bytesFromCache,
    };
  }

  set(content: string, value: T): void {
    const h = this.hash(content);
    this.data[h] = { hash: h, value };
    this.dirty = true;
    this.writes++;
  }

  /** Persist to disk. A no-op when nothing has changed since the last save, so
   *  callers can flush defensively without paying for a redundant whole-file
   *  rewrite. */
  save(): void {
    if (!this.dirty) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data));
    this.dirty = false;
  }

  private hash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}
