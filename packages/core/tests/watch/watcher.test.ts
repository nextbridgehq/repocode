import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startWatch } from '../../src/watch/watcher.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import type { RepoCodeConfig, PackResult } from '../../src/types.js';

let tmpDir: string;

function write(rel: string, content: string): void {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Poll until `predicate` holds, or give up after `timeoutMs`.
 *
 *  A fixed sleep is the wrong tool for "the debounced repack has landed": it encodes a guess
 *  about how fast the machine is. Under a loaded full-suite run that guess fails while the
 *  behaviour under test is perfectly correct. Waiting for the condition keeps the assertion
 *  honest and lets a genuine failure still surface, as a timeout. */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await wait(10);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-watch-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeConfig(): RepoCodeConfig {
  return {
    ...DEFAULT_CONFIG,
    root: tmpDir,
    output: { ...DEFAULT_CONFIG.output, format: 'json', preamble: false },
    security: { enabled: false, mode: 'warn' },
  };
}

describe('startWatch', () => {
  it('runs an initial pack on startup', async () => {
    write('a.ts', 'export const a = 1;\n');
    const repacks: PackResult[] = [];
    const handle = await startWatch({
      config: makeConfig(),
      debounceMs: 50,
      onRepack: (result) => { repacks.push(result); },
    });
    expect(repacks.length).toBe(1);
    await handle.stop();
  });

  it('collapses rapid sequential writes into one debounced repack', async () => {
    write('a.ts', 'export const a = 1;\n');
    const repacks: { result: PackResult; changed: string[] }[] = [];
    const handle = await startWatch({
      config: makeConfig(),
      debounceMs: 100,
      onRepack: (result, changed) => { repacks.push({ result, changed }); },
    });
    expect(repacks.length).toBe(1); // initial pack

    write('a.ts', 'export const a = 2;\n');
    await wait(20);
    write('a.ts', 'export const a = 3;\n');
    await wait(20);
    write('a.ts', 'export const a = 4;\n');

    // Two things are being asserted, and they need different waits. That the debounced repack
    // happens at all is a positive outcome, so wait for it rather than for a fixed duration.
    await waitFor(() => repacks.length >= 2);
    // That the three writes collapsed into *one* repack is a negative outcome, so it needs a
    // settle window: give any extra repacks well past the 100ms debounce to show up.
    await wait(300);
    expect(repacks.length).toBe(2); // initial + exactly one debounced repack
    await handle.stop();
  });

  it('does not trigger a repack for changes under an ignored path', async () => {
    write('a.ts', 'export const a = 1;\n');
    let repackCount = 0;
    const handle = await startWatch({
      config: makeConfig(),
      debounceMs: 50,
      onRepack: () => { repackCount++; },
    });
    expect(repackCount).toBe(1);

    write('node_modules/dep/index.js', 'module.exports = {};\n');
    await wait(250);
    expect(repackCount).toBe(1); // still just the initial pack
    await handle.stop();
  });

  it('stop() closes the watcher and resolves cleanly', async () => {
    write('a.ts', 'export const a = 1;\n');
    const handle = await startWatch({
      config: makeConfig(),
      debounceMs: 50,
      onRepack: () => {},
    });
    await expect(handle.stop()).resolves.toBeUndefined();
  });

  it('onError is optional — startWatch works without it and never invokes it absent a real error', async () => {
    write('a.ts', 'export const a = 1;\n');
    let received: Error | null = null;
    const handle = await startWatch({
      config: makeConfig(),
      debounceMs: 50,
      onRepack: () => {},
      onError: (err) => { received = err; },
    });
    await wait(100);
    expect(received).toBeNull();
    await handle.stop();
  });

  it('overlapping repacks: a change arriving mid-repack triggers exactly one trailing repack', async () => {
    write('a.ts', 'export const a = 1;\n');
    let repackCount = 0;
    let releaseSecondRepack: (() => void) | null = null;
    // Deterministic: resolves exactly when repack #2 enters onRepack (before it hangs).
    let repack2Started!: () => void;
    const repack2InFlight = new Promise<void>(r => { repack2Started = r; });
    const handle = await startWatch({
      config: makeConfig(),
      debounceMs: 30,
      onRepack: async () => {
        repackCount++;
        if (repackCount === 2) {
          repack2Started(); // signal before hanging
          await new Promise<void>((resolve) => { releaseSecondRepack = resolve; });
        }
      },
    });
    expect(repackCount).toBe(1); // initial

    write('a.ts', 'export const a = 2;\n');
    await repack2InFlight; // deterministic: wait until repack #2 actually starts
    expect(repackCount).toBe(2);

    write('b.ts', 'export const b = 1;\n'); // write to a different file to avoid mtime granularity issues on CI
    await wait(100);
    releaseSecondRepack?.();
    await wait(400); // allow the queued trailing repack to run

    expect(repackCount).toBe(3); // initial, in-flight, exactly one trailing repack
    await handle.stop();
  });

  it('does not produce more than one extra repack when changes arrive rapidly during a repack', async () => {
    let repackCount = 0;
    let resolveSlowRepack!: () => void;
    // Use a promise to signal that the 2nd repack is ACTUALLY in-flight, not just wait(N)ms.
    // This makes the test deterministic regardless of machine load.
    let repack2Started!: () => void;
    const repack2InFlight = new Promise<void>(r => { repack2Started = r; });

    const handle = await startWatch({
      config: makeConfig(),
      debounceMs: 50,
      onRepack: async (_result, _changedPaths) => {
        repackCount++;
        if (repackCount === 1) return;
        if (repackCount === 2) {
          repack2Started();  // signal that we are now inside the slow repack
          await new Promise<void>(resolve => { resolveSlowRepack = resolve; });
        }
      },
    });

    // Trigger the second repack and wait until it is KNOWN to be in-flight
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'export const a = 1;');
    await repack2InFlight; // deterministic: resolves exactly when 2nd repack starts

    // While 2nd repack is in flight, send two more rapid changes
    fs.writeFileSync(path.join(tmpDir, 'b.ts'), 'export const b = 1;');
    await wait(20);
    fs.writeFileSync(path.join(tmpDir, 'c.ts'), 'export const c = 1;');
    await wait(20);

    // Unlock the second repack
    resolveSlowRepack();

    // Wait for the trailing repack to complete (debounce + pipeline)
    await wait(400);

    await handle.stop();

    // Should be: 1 initial + 1 slow + 1 trailing = 3 total (not 4+)
    expect(repackCount).toBeLessThanOrEqual(3);
  });

  it('does not schedule a new repack for events arriving after stop() has begun', async () => {
    write('a.ts', 'export const a = 1;\n');
    let repackCount = 0;
    const handle = await startWatch({
      config: makeConfig(),
      debounceMs: 30,
      onRepack: () => { repackCount++; },
    });
    expect(repackCount).toBe(1); // initial

    const stopPromise = handle.stop();
    // Fire a filesystem event while stop() is in flight (between clearing the timer and watcher.close()
    // resolving). Without the `stopped` guard, this schedules a new debounce timer that stop() never waits for.
    write('a.ts', 'export const a = 2;\n');
    await stopPromise;

    await wait(200); // long enough for the old 30ms debounce to have fired if it was wrongly scheduled
    expect(repackCount).toBe(1); // still just the initial pack — no repack scheduled after stop() began
  });
});
