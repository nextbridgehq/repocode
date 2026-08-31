import { describe, it, expect } from 'vitest';
import { traceHardCase } from '../golden/goldenHelper.js';

const ENTRY = 'src/consumer.ts';

// A re-export chain: consumer -> barrel (export *) -> inner/barrel (export {}) -> thing.
// This already works — each barrel's own `export ... from` is extracted like any other
// import once that barrel joins the traversal. These assertions are regression cover, so a
// future change to the extraction patterns or the BFS cannot silently break it.
describe('typescript barrel re-export chains (hard case)', () => {
  it('depth 1: reaches the first barrel only', async () => {
    expect(await traceHardCase('ts-barrel-chain', ENTRY, 1)).toEqual({
      dependencies: ['src/barrel.ts'],
      importers: [],
    });
  });

  it('depth 2: follows the first re-export hop', async () => {
    expect(await traceHardCase('ts-barrel-chain', ENTRY, 2)).toEqual({
      dependencies: ['src/barrel.ts', 'src/inner/barrel.ts'],
      importers: [],
    });
  });

  it('depth 3: reaches the real module at the end of the chain', async () => {
    expect(await traceHardCase('ts-barrel-chain', ENTRY, 3)).toEqual({
      dependencies: ['src/barrel.ts', 'src/inner/barrel.ts', 'src/inner/thing.ts'],
      importers: [],
    });
  });
});
