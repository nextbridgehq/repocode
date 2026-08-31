#!/usr/bin/env bash
# Inspect ranking decisions without writing any output: prints the ranked
# file table to stderr and exits. Useful for sanity-checking why a file
# was or wasn't included before you commit to a budget.
set -euo pipefail

npx repocode . --explain
