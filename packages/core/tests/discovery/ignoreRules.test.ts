import { describe, it, expect } from 'vitest';
import { buildIgnoreFilter, resolveIgnorePatterns, findIgnoredDirs } from '../../src/discovery/ignoreRules.js';
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

describe('findIgnoredDirs', () => {
  const cfg = { useGitignore: true, useDefaultPatterns: true, customPatterns: [] as string[] };
  const mk = (gitignore: string, dirs: string[]) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-ignored-'));
    for (const d of dirs) fs.mkdirSync(path.join(root, d), { recursive: true });
    fs.writeFileSync(path.join(root, '.gitignore'), gitignore);
    return root;
  };

  // Discovery prunes its walk only with the default list, so a directory ignored by .gitignore
  // alone (venv/, target/, a generated tree) was crawled file by file and then filtered out.
  it('returns directories the .gitignore ignores, at any depth', () => {
    const root = mk('venv/\n/target\ndocs/generated/\n', ['venv', 'target', 'docs/generated', 'docs/guide', 'src']);
    expect(findIgnoredDirs(root, cfg).sort()).toEqual(['docs/generated', 'target', 'venv']);
    fs.rmSync(root, { recursive: true });
  });

  it('does not descend into an ignored directory', () => {
    const root = mk('venv/\n', ['venv/lib/deep', 'src']);
    expect(findIgnoredDirs(root, cfg)).toEqual(['venv']);
    fs.rmSync(root, { recursive: true });
  });

  it('ignores patterns that match files, not directories', () => {
    const root = mk('*.log\n', ['logs', 'src']);
    expect(findIgnoredDirs(root, cfg)).toEqual([]);
    fs.rmSync(root, { recursive: true });
  });

  // globby cannot honour negation, so pruning a directory a later `!` pattern re-includes would
  // silently drop files. With any negation present, prune nothing from the .gitignore.
  it('returns nothing when a negation pattern is present', () => {
    const root = mk('build_out/\n!build_out/keep/\n', ['build_out/keep', 'src']);
    expect(findIgnoredDirs(root, cfg)).toEqual([]);
    fs.rmSync(root, { recursive: true });
  });
});
