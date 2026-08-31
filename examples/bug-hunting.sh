#!/usr/bin/env bash
# Scope context around a bug's domain instead of packing the whole repo.
# Swap the --query text for whatever describes the area you're debugging.
set -euo pipefail

npx repocode . --query "authentication and session handling" --instruction bugfix --budget 60k
