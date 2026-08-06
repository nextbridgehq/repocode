import { describe, it, expect, vi, afterEach } from 'vitest';

// Kept in its own file: the sibling secretScanner.test.ts declares a top-level
// vi.mock, which would evaluate the secretlint modules before this assertion
// could observe that they had not been loaded.
describe('@secretlint lazy loading', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@secretlint/config-loader');
    vi.doUnmock('@secretlint/core');
  });

  it('does not evaluate @secretlint modules until a scan actually runs', async () => {
    vi.resetModules();
    let configLoaderEvaluated = false;
    let coreEvaluated = false;

    vi.doMock('@secretlint/config-loader', async (importOriginal) => {
      configLoaderEvaluated = true;
      return await importOriginal<typeof import('@secretlint/config-loader')>();
    });
    vi.doMock('@secretlint/core', async (importOriginal) => {
      coreEvaluated = true;
      return await importOriginal<typeof import('@secretlint/core')>();
    });

    const { scanForSecrets } = await import('../../src/security/secretScanner.js');

    // Importing the scanner must not drag in the secretlint dependency tree —
    // packs with security disabled never pay for it.
    expect(configLoaderEvaluated).toBe(false);
    expect(coreEvaluated).toBe(false);

    await scanForSecrets('a.ts', 'const x = 1;', 'warn');

    expect(configLoaderEvaluated).toBe(true);
    expect(coreEvaluated).toBe(true);
  });
});
