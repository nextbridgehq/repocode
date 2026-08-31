import { describe, it, expect } from 'vitest';
import { traceHardCase } from '../golden/goldenHelper.js';

const ENTRY = 'main.go';

// A local `errors/` directory and a `vendor/github.com/pkg/errors/` mirror both exist here.
// Real Go always resolves `import "github.com/pkg/errors"` to the vendored package — the
// vendor probe must run before the local suffix-stripping fallback, or this would silently
// resolve to the wrong package (a wrong answer, not a missing one).
describe('go vendor probe precedence over a local shadow (hard case)', () => {
  it('depth 1: prefers the vendored package over a same-named local directory', async () => {
    expect(await traceHardCase('go-vendor-shadow', ENTRY, 1)).toEqual({
      dependencies: ['vendor/github.com/pkg/errors/errors.go'],
      importers: [],
    });
  });

  it('depth 2: unchanged — the vendored package imports nothing project-local', async () => {
    expect(await traceHardCase('go-vendor-shadow', ENTRY, 2)).toEqual({
      dependencies: ['vendor/github.com/pkg/errors/errors.go'],
      importers: [],
    });
  });
});
