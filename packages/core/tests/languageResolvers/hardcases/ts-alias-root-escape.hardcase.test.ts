import { describe, it, expect } from 'vitest';
import { traceHardCase } from '../golden/goldenHelper.js';

const ENTRY = 'entry.ts';

// A monorepo tsconfig can point baseUrl outside the pack root (e.g. "../.."). Resolving an
// alias through it would pull a file from outside --root into the packed output — a silent
// scope-widening bug, not just a missing resolution. resolveAlias must refuse a hit whose
// root-relative path escapes root rather than returning a `../`-prefixed path.
describe('typescript path alias baseUrl escaping the pack root (hard case)', () => {
  it('depth 1: refuses to resolve an alias whose baseUrl points outside root', async () => {
    expect(await traceHardCase('ts-alias-root-escape', ENTRY, 1)).toEqual({
      dependencies: [],
      importers: [],
    });
  });
});
