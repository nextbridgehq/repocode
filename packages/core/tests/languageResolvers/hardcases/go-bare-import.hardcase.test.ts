import { describe, it, expect } from 'vitest';
import { traceHardCase } from '../golden/goldenHelper.js';

const ENTRY = 'main.go';

// `import "path"` with no parentheses is a distinct syntactic form from the parenthesized
// import block, and was previously never captured by extraction at all.
describe('go bare single-line imports (hard case)', () => {
  it('depth 1: captures and resolves an unparenthesized import', async () => {
    expect(await traceHardCase('go-bare-import', ENTRY, 1)).toEqual({
      dependencies: ['internal/registered/registered.go', 'internal/util/util.go'],
      importers: [],
    });
  });

  it('depth 2: unchanged — util.go\'s bare stdlib import resolves to nothing', async () => {
    expect(await traceHardCase('go-bare-import', ENTRY, 2)).toEqual({
      dependencies: ['internal/registered/registered.go', 'internal/util/util.go'],
      importers: [],
    });
  });
});
