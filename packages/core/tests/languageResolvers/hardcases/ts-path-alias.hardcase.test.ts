import { describe, it, expect } from 'vitest';
import { traceHardCase } from '../golden/goldenHelper.js';

const ENTRY = 'src/entry.ts';

// entry.ts imports '@app/helper' (wildcard alias) and '@shared' (exact alias), neither of
// which is a relative specifier — both resolve only through tsconfig's compilerOptions.paths.
// The fixture's paths are written relative to baseUrl ("src"), so these also fail if baseUrl
// is ignored: 'app/helper' probed from the repo root does not exist.
describe('typescript path aliases (hard case)', () => {
  it('depth 1: resolves both a wildcard alias and an exact alias', async () => {
    expect(await traceHardCase('ts-path-alias', ENTRY, 1)).toEqual({
      dependencies: ['src/app/helper.ts', 'src/shared/index.ts'],
      importers: [],
    });
  });

  it('depth 2: unchanged — neither aliased file imports anything further', async () => {
    expect(await traceHardCase('ts-path-alias', ENTRY, 2)).toEqual({
      dependencies: ['src/app/helper.ts', 'src/shared/index.ts'],
      importers: [],
    });
  });
});
