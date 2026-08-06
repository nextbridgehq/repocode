#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: ./scripts/release.sh <semver>  e.g. 1.0.0}"

echo "Bumping all packages to v${VERSION}..."
node "$(dirname "$0")/bump-version.js" "$VERSION"

echo ""
echo "Committing version bump..."
git add packages/core/package.json packages/cli/package.json packages/mcp/package.json
git commit -m "chore: release v${VERSION}"

echo "Tagging v${VERSION}..."
git tag "v${VERSION}"

echo "Pushing to origin..."
git push
git push --tags

echo ""
echo "Done. GitHub Actions will publish automatically once the tag reaches CI."
echo "Monitor the release at: https://github.com/nextbridgehq/repocode/actions"
