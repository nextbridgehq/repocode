import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30000,
    // beforeAll hooks here build throwaway git repositories (init, commits, branches), which
    // outran the 10s default once the whole workspace's tests ran in parallel.
    hookTimeout: 60000,
  },
});
