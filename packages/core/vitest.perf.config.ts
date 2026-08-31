import { defineConfig } from 'vitest/config';

// This config's include pattern is what makes packSynthetic10k.perf.ts reachable at all —
// vitest.config.ts (the default, used by `pnpm test`) never matches a file that isn't named
// *.test.ts/*.spec.ts, so this dedicated config is the ONLY way to run the perf test. Do not
// rename the perf test file to *.test.ts — that would make it join every local `pnpm test`
// run and CI's `pnpm -r test` step too, adding ~60-90s to both.
export default defineConfig({
  test: {
    include: ['tests/perf/**/*.perf.ts'],
    testTimeout: 300_000,
  },
});
