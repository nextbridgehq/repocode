# Contributing

1. Fork and clone
2. `pnpm install`
3. `pnpm -r build`
4. `pnpm -r test`
5. `pnpm --filter @repocode/core test:perf` (optional, ~1 minute — CI runs this on every PR;
   running it locally first can save a round-trip)
6. Open a PR against `main`

## Requirements
- Node.js >= 20
- pnpm >= 10
