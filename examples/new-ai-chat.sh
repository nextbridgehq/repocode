#!/usr/bin/env bash
# Pack a feature branch's diff (plus dependencies) as Markdown and copy it to
# the clipboard, ready to paste into a fresh AI chat session.
# Replace `feature/auth` with the branch you're working on.
set -euo pipefail

npx repocode . --branch feature/auth --format markdown --copy
