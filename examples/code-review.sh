#!/usr/bin/env bash
# Pack a PR's changed files, plus their immediate dependencies, for a code review pass.
# Run from inside the repository you want to review.
set -euo pipefail

npx repocode . --pr --instruction review --budget 80k
