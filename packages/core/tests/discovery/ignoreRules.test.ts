import { describe, it, expect } from 'vitest';
import { buildIgnoreFilter, resolveIgnorePatterns } from '../../src/discovery/ignoreRules.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

describe('buildIgnoreFilter', () => {
  it('ignores node_modules by default', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-test-'));
    const filter = await buildIgnoreFilter(tmpDir, {
      useGitignore: false,
      useDefaultPatterns: true,
      customPatterns: [],
    });
    expect(filter('node_modules/lodash/index.js')).toBe(false);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('respects custom patterns', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-test-'));
    const filter = await buildIgnoreFilter(tmpDir, {
      useGitignore: false,
      useDefaultPatterns: false,
      customPatterns: ['**/*.test.ts'],
    });
    expect(filter('src/auth/auth.test.ts')).toBe(false);
    expect(filter('src/auth/auth.ts')).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('reads .gitignore when useGitignore is true', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-test-'));
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'dist/\n*.log\n');
    const filter = await buildIgnoreFilter(tmpDir, {
      useGitignore: true,
      useDefaultPatterns: false,
      customPatterns: [],
    });
    expect(filter('dist/index.js')).toBe(false);
    expect(filter('error.log')).toBe(false);
    expect(filter('src/index.ts')).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('resolveIgnorePatterns returns default patterns including node_modules/**', () => {
    const patterns = resolveIgnorePatterns('/nonexistent-root', { useGitignore: false, useDefaultPatterns: true, customPatterns: [] });
    expect(patterns).toContain('node_modules/**');
    expect(patterns).toContain('.git/**');
  });
});

describe('ignoreRules — Repomix interop', () => {
  it('honours .repomixignore so a Repomix user need not re-declare exclusions', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-repomixignore-'));
    try {
      fs.writeFileSync(path.join(root, '.repomixignore'), '# generated\nbuild/**\n*.snap\n');
      const filter = await buildIgnoreFilter(root, {
        useGitignore: false, useDefaultPatterns: false, customPatterns: [],
      });
      expect(filter('build/out.js')).toBe(false);
      expect(filter('src/a.test.ts.snap')).toBe(false);
      expect(filter('src/a.ts')).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
