import { describe, it, expect, vi, beforeEach } from 'vitest';

interface FakeWorkerInstance {
  terminated: boolean;
  listeners: Record<string, Array<(...args: unknown[]) => void>>;
}

let instances: FakeWorkerInstance[] = [];

vi.mock('worker_threads', () => {
  class FakeWorker {
    terminated = false;
    listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    constructor() {
      instances.push(this);
    }
    on(event: string, cb: (...args: unknown[]) => void): this {
      (this.listeners[event] ??= []).push(cb);
      return this;
    }
    postMessage(): void {
      // Never responds — simulates a hung worker.
    }
    terminate(): Promise<number> {
      this.terminated = true;
      return Promise.resolve(0);
    }
  }
  return { Worker: FakeWorker };
});

beforeEach(() => {
  instances = [];
});

describe('encodeInWorkers timeout', () => {
  it('terminates a worker that never responds and rejects with a timeout error', async () => {
    const { encodeInWorkers } = await import('../../src/tokens/accurateEstimator.js');
    await expect(encodeInWorkers(['a.ts'], 20)).rejects.toThrow(/timed out/i);
    expect(instances.length).toBe(1);
    expect(instances[0].terminated).toBe(true);
  });

  it('terminates the worker on an error event instead of leaking it', async () => {
    vi.resetModules();
    vi.doMock('worker_threads', () => {
      class FakeWorker {
        terminated = false;
        listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
        constructor() {
          instances.push(this);
        }
        on(event: string, cb: (...args: unknown[]) => void): this {
          (this.listeners[event] ??= []).push(cb);
          if (event === 'error') {
            // Fire the error on next tick, after postMessage has been called.
            setTimeout(() => cb(new Error('boom')), 0);
          }
          return this;
        }
        postMessage(): void {}
        terminate(): Promise<number> {
          this.terminated = true;
          return Promise.resolve(0);
        }
      }
      return { Worker: FakeWorker };
    });
    const { encodeInWorkers } = await import('../../src/tokens/accurateEstimator.js');
    await expect(encodeInWorkers(['a.ts'], 5000)).rejects.toThrow(/boom/);
    expect(instances.length).toBe(1);
    expect(instances[0].terminated).toBe(true);
  });

  it('resolves with data and terminates the worker on a successful message event', async () => {
    vi.resetModules();
    vi.doMock('worker_threads', () => {
      class FakeWorker {
        terminated = false;
        listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
        constructor() {
          instances.push(this);
        }
        on(event: string, cb: (...args: unknown[]) => void): this {
          (this.listeners[event] ??= []).push(cb);
          return this;
        }
        postMessage(): void {
          // Fire the message event synchronously with a valid payload.
          const messageListeners = this.listeners['message'] || [];
          for (const cb of messageListeners) {
            cb([['a.ts', 5]]);
          }
        }
        terminate(): Promise<number> {
          this.terminated = true;
          return Promise.resolve(0);
        }
      }
      return { Worker: FakeWorker };
    });
    const { encodeInWorkers } = await import('../../src/tokens/accurateEstimator.js');
    const result = await encodeInWorkers(['a.ts']);
    expect(result.get('a.ts')).toBe(5);
    expect(instances.length).toBe(1);
    expect(instances[0].terminated).toBe(true);
  });

  it('does not terminate the worker on a non-zero exit event', async () => {
    vi.resetModules();
    vi.doMock('worker_threads', () => {
      class FakeWorker {
        terminated = false;
        listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
        constructor() {
          instances.push(this);
        }
        on(event: string, cb: (...args: unknown[]) => void): this {
          (this.listeners[event] ??= []).push(cb);
          if (event === 'exit') {
            // Fire the exit event on next tick with a non-zero code.
            setTimeout(() => cb(1), 0);
          }
          return this;
        }
        postMessage(): void {}
        terminate(): Promise<number> {
          this.terminated = true;
          return Promise.resolve(0);
        }
      }
      return { Worker: FakeWorker };
    });
    const { encodeInWorkers } = await import('../../src/tokens/accurateEstimator.js');
    await expect(encodeInWorkers(['a.ts'], 5000)).rejects.toThrow(/exited with code 1/i);
    expect(instances.length).toBe(1);
    expect(instances[0].terminated).toBe(false);
  });
});
