import { describe, it, expect } from 'vitest';
import { traceHardCase } from '../golden/goldenHelper.js';

const ENTRY = 'main.go';

// Go's vendor/ directory mirrors the full import path verbatim, so
// `import "github.com/pkg/errors"` lives at vendor/github.com/pkg/errors/.
describe('go vendored imports (hard case)', () => {
  it('depth 1: resolves a vendored dependency to its source file', async () => {
    expect(await traceHardCase('go-vendor', ENTRY, 1)).toEqual({
      dependencies: ['vendor/github.com/pkg/errors/errors.go'],
      importers: [],
    });
  });

  it('depth 2: unchanged — the vendored package imports nothing project-local', async () => {
    expect(await traceHardCase('go-vendor', ENTRY, 2)).toEqual({
      dependencies: ['vendor/github.com/pkg/errors/errors.go'],
      importers: [],
    });
  });
});
