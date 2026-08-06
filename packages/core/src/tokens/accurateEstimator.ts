// tiktoken is imported dynamically inside getEncoder() rather than statically.
// It ships a WASM binary that can fail to load entirely (unsupported platform,
// missing binary, restricted runtime); a static import would reject this whole
// module graph before any handler could run, defeating the fallback below.
// This type-only import is erased at compile time and is safe to keep static.
import type { Tiktoken } from 'tiktoken';
import { Worker } from 'worker_threads';
import { cpus } from 'os';
import fs from 'fs';
import path from 'path';
import { estimateFast } from './fastEstimator.js';
import type { FileCache } from '../cache/fileCache.js';

const WORKER_THRESHOLD = 200;
const WORKER_FILE = new URL('./encoderWorker.js', import.meta.url);
const WORKER_TIMEOUT_MS = 30_000;

let enc: Tiktoken | null = null;
let warnedAboutFallback = false;
/** Set once the encoder has failed, so we don't retry a failing import per call. */
let encoderUnavailable = false;

async function getEncoder(): Promise<Tiktoken | null> {
  if (enc) return enc;
  if (encoderUnavailable) return null;
  try {
    // Covers both the module failing to load and get_encoding() itself throwing.
    const { get_encoding } = await import('tiktoken');
    enc = get_encoding('cl100k_base');
  } catch {
    encoderUnavailable = true;
    if (!warnedAboutFallback) {
      process.stderr.write(
        '[repocode] warning: tiktoken failed to load; using fast token estimator (counts may be approximate)\n'
      );
      warnedAboutFallback = true;
    }
  }
  return enc;
}

export async function encodeInWorkers(filePaths: string[], timeoutMs: number = WORKER_TIMEOUT_MS): Promise<Map<string, number>> {
  const workerCount = Math.min(cpus().length, Math.floor(filePaths.length / 50));
  const chunkSize = Math.ceil(filePaths.length / workerCount);
  const chunks: string[][] = [];
  for (let i = 0; i < filePaths.length; i += chunkSize) {
    chunks.push(filePaths.slice(i, i + chunkSize));
  }

  const results = await Promise.all(
    chunks.map(
      chunk =>
        new Promise<[string, number][]>((resolve, reject) => {
          const w = new Worker(WORKER_FILE);
          let settled = false;

          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            w.terminate();
            reject(new Error(`Worker timed out after ${timeoutMs}ms`));
          }, timeoutMs);

          w.on('message', (data: [string, number][]) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            w.terminate();
            resolve(data);
          });
          w.on('error', (err: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            w.terminate();
            reject(err instanceof Error ? err : new Error(String(err)));
          });
          w.on('exit', (code: number) => {
            if (settled) return;
            if (code !== 0) {
              settled = true;
              clearTimeout(timer);
              reject(new Error(`Worker exited with code ${code}`));
            }
          });
          w.postMessage(chunk);
        })
    )
  );

  return new Map(results.flat());
}

export async function estimateAccurateBatch(
  filePaths: string[],
  cache?: FileCache,
  root?: string,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const uncached: string[] = [];
  // Only populated when cache+root are provided — content read once here for the cache-hash
  // check is reused below instead of being re-read for encoding and for the cache write-back.
  const uncachedContent = new Map<string, string>();

  // Resolve cache hits first
  if (cache && root) {
    for (const fp of filePaths) {
      try {
        const content = fs.readFileSync(fp, 'utf-8');
        const relPath = path.relative(root, fp);
        const cached = cache.get(relPath, content);
        if (cached?.accurateTokens !== undefined) {
          result.set(fp, cached.accurateTokens);
        } else {
          uncached.push(fp);
          uncachedContent.set(fp, content);
        }
      } catch {
        result.set(fp, 0);
      }
    }
  } else {
    uncached.push(...filePaths);
  }

  if (uncached.length === 0) return result;

  // Dispatch: workers for >=200 uncached files, sequential otherwise
  let encoded: Map<string, number>;
  if (uncached.length >= WORKER_THRESHOLD) {
    try {
      encoded = await encodeInWorkers(uncached);
    } catch {
      // Worker dispatch failed — fall back to sequential
      encoded = await encodeSequential(uncached, uncachedContent);
    }
  } else {
    encoded = await encodeSequential(uncached, uncachedContent);
  }

  // Merge encoded results into result map and update cache
  for (const [fp, tokens] of encoded) {
    result.set(fp, tokens);
    if (cache && root) {
      const content = uncachedContent.get(fp);
      if (content !== undefined) {
        const relPath = path.relative(root, fp);
        cache.set(relPath, content, { accurateTokens: tokens });
      }
    }
  }

  return result;
}

async function encodeSequential(filePaths: string[], preRead: Map<string, string> = new Map()): Promise<Map<string, number>> {
  const encoder = await getEncoder();
  const result = new Map<string, number>();
  for (const fp of filePaths) {
    try {
      const content = preRead.get(fp) ?? fs.readFileSync(fp, 'utf-8');
      const tokens = encoder ? encoder.encode(content).length : estimateFast(content);
      result.set(fp, tokens);
    } catch {
      result.set(fp, 0);
    }
  }
  return result;
}
