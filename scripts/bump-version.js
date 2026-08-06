#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error('Usage: node scripts/bump-version.js <semver>  e.g. 1.0.0');
  process.exit(1);
}

const packages = [
  'packages/core',
  'packages/cli',
  'packages/mcp',
];

const root = path.resolve(__dirname, '..');

for (const pkg of packages) {
  const pkgPath = path.join(root, pkg, 'package.json');
  const json = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  json.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(json, null, 2) + '\n');
  console.log(`  ${pkg}/package.json  →  ${version}`);
}

console.log(`\nAll packages bumped to ${version}.`);
console.log('Next steps:');
console.log('  git add packages/*/package.json');
console.log(`  git commit -m "chore: release v${version}"`);
console.log(`  git tag v${version}`);
console.log('  git push && git push --tags');
