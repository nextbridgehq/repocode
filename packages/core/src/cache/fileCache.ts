import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import lockfile from 'proper-lockfile';
import { atomicWriteFileSync } from '../utils/atomicWrite.js';
import type { CacheStat } from '../types.js';

export interface CacheFileEntry {
  hash: string;
  accurateTokens?: number;
  imports?: string[];
}

interface FileCacheData {
  version: 1;
  files: Record<string, CacheFileEntry>;
}

const LOCK_OPTIONS = {
  // cache.json does not exist on a first run; realpath:false lets us lock a
  // path that is not there yet instead of throwing ENOENT.
  realpath: false,
  // A lock older than this is treated as abandoned, so a process killed
  // mid-save cannot deadlock every later run.
  stale: 10_000,
};

// proper-lockfile's sync API rejects its own `retries` option (throws ESYNC),
// so the backoff schedule lives here. Totals ~1.8s before giving up.
const LOCK_RETRY_DELAYS_MS = [100, 150, 225, 340, 500, 500];

/** Blocks the thread without a busy loop. Node permits this on the main thread. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Thrown by acquireLockSync for any lock error that is not genuine contention. */
class LockAcquisitionError extends Error {}

/**
 * Returns a release function on success, or null once the retry schedule is
 * exhausted for genuine lock contention (ELOCKED). Any other error — EACCES
 * from a root-owned .repocode/ dir, EROFS on a read-only mount, etc. — will
 * never resolve by retrying, so it is thrown immediately instead of sleeping
 * through the whole backoff schedule; the caller is responsible for turning
 * that into a single warning (see save()).
 */
function acquireLockSync(target: string): (() => void) | null {
  for (let attempt = 0; ; attempt++) {
    try {
      return lockfile.lockSync(target, LOCK_OPTIONS);
    } catch (err: unknown) {
      const code = err && typeof err === 'object' && 'code' in err ? (err as { code: unknown }).code : undefined;
      if (code !== 'ELOCKED') {
        const message = err instanceof Error ? err.message : String(err);
        throw new LockAcquisitionError(message);
      }
      if (attempt >= LOCK_RETRY_DELAYS_MS.length) return null;
      sleepSync(LOCK_RETRY_DELAYS_MS[attempt]);
    }
  }
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

function normalizeKey(relPath: string): string {
  return relPath.replace(/\\/g, '/');
}

export class FileCache {
  private data: FileCacheData;
  private cachePath: string;
  private dirty = false;
  private hits = 0;
  private misses = 0;
  private writes = 0;
  private bytesFromCache = 0;
  /** Keys this instance wrote; only these are layered onto the on-disk state. */
  private writtenKeys = new Set<string>();
  /** Keys this instance pruned, with the hash they had at prune time. */
  private prunedKeys = new Map<string, string>();

  private constructor(cachePath: string, data: FileCacheData) {
    this.cachePath = cachePath;
    this.data = data;
  }

  private static readRaw(cachePath: string): FileCacheData | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as FileCacheData;
      if (parsed.version !== 1 || typeof parsed.files !== 'object' || parsed.files === null) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  static load(root: string): FileCache {
    const cachePath = path.join(root, '.repocode', 'cache.json');
    return new FileCache(cachePath, FileCache.readRaw(cachePath) ?? { version: 1, files: {} });
  }

  get(relPath: string, content: string): CacheFileEntry | undefined {
    const key = normalizeKey(relPath);
    const entry = this.data.files[key];
    if (!entry || entry.hash !== hashContent(content)) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    this.bytesFromCache += Buffer.byteLength(content, 'utf-8');
    return entry;
  }

  /** Hit/miss counters for this cache instance, surfaced via PackResult.cacheStats. */
  stats(): CacheStat {
    return {
      hits: this.hits,
      misses: this.misses,
      writes: this.writes,
      bytesFromCache: this.bytesFromCache,
    };
  }

  set(relPath: string, content: string, data: Partial<Omit<CacheFileEntry, 'hash'>>): void {
    const key = normalizeKey(relPath);
    const hash = hashContent(content);
    const existing = this.data.files[key];
    if (existing && existing.hash === hash) {
      Object.assign(existing, data);
    } else {
      this.data.files[key] = { hash, ...data };
    }
    this.writtenKeys.add(key);
    this.dirty = true;
    this.writes++;
  }

  // livePaths must use the same forward-slash-relative key format as get()/set().
  prune(livePaths: Set<string>): void {
    for (const key of Object.keys(this.data.files)) {
      if (!livePaths.has(key)) {
        this.prunedKeys.set(key, this.data.files[key].hash);
        delete this.data.files[key];
        this.dirty = true;
      }
    }
  }

  /**
   * Re-read the current on-disk state and layer this instance's changes on top,
   * so entries written by a concurrent process survive instead of being
   * overwritten by our (possibly stale) in-memory snapshot.
   */
  private mergeWithDisk(): FileCacheData {
    const merged = FileCache.readRaw(this.cachePath) ?? { version: 1 as const, files: {} };

    for (const key of this.writtenKeys) {
      const entry = this.data.files[key];
      if (entry) merged.files[key] = entry;
    }

    // Only drop a pruned key if nobody else touched it since we pruned it —
    // otherwise a run with a narrower file set (e.g. a git-mode pack) would
    // delete entries another run just added.
    for (const [key, hashWhenPruned] of this.prunedKeys) {
      if (merged.files[key]?.hash === hashWhenPruned) delete merged.files[key];
    }

    return merged;
  }

  save(): void {
    if (!this.dirty) return;
    fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });

    let release: (() => void) | null;
    try {
      release = acquireLockSync(this.cachePath);
    } catch (err: unknown) {
      // A non-contention lock error (permissions, read-only filesystem, ...)
      // will never resolve by retrying; skipping the write costs cache misses
      // next run, nothing more, so report the real cause and move on.
      const message = err instanceof LockAcquisitionError ? err.message : String(err);
      process.stderr.write(`[repocode] warning: cache lock failed unexpectedly: ${message}\n`);
      return;
    }
    if (!release) {
      // The cache is a performance optimisation, not a correctness dependency:
      // skipping the write costs cache misses next run, nothing more.
      process.stderr.write(
        '[repocode] warning: could not acquire cache lock; skipping cache write\n',
      );
      return;
    }

    try {
      const merged = this.mergeWithDisk();
      atomicWriteFileSync(this.cachePath, JSON.stringify(merged, null, 2));
      this.data = merged;
      this.dirty = false;
      this.writtenKeys.clear();
      this.prunedKeys.clear();
    } finally {
      try { release(); } catch { /* lock already released or broken; nothing to undo */ }
    }
  }
}
