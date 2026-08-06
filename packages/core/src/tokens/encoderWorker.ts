import { parentPort } from 'worker_threads';
import type { Tiktoken } from 'tiktoken';
import fs from 'fs';
import { estimateFast } from './fastEstimator.js';

// Each worker gets its own encoder instance — same fallback pattern as main thread.
// Imported dynamically for the same reason as in accurateEstimator.ts: a static
// import of tiktoken crashes the worker at startup if the module cannot load,
// so every worker dies and the caller silently redoes the whole batch
// sequentially. Loading it here lets the worker degrade to estimateFast instead.
let enc: Tiktoken | null = null;
try {
  const { get_encoding } = await import('tiktoken');
  enc = get_encoding('cl100k_base');
} catch {
  // tiktoken unavailable (module load or WASM init) — fall back to estimateFast
}

parentPort!.on('message', (filePaths: string[]) => {
  const results: [string, number][] = [];
  for (const fp of filePaths) {
    try {
      const content = fs.readFileSync(fp, 'utf-8');
      const tokens = enc ? enc.encode(content).length : estimateFast(content);
      results.push([fp, tokens]);
    } catch {
      results.push([fp, 0]);
    }
  }
  parentPort!.postMessage(results);
});
