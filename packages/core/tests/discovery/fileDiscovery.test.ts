import { describe, it, expect } from 'vitest';
import { discoverFiles } from '../../src/discovery/fileDiscovery.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../fixtures/simple-ts');

describe('discoverFiles', () => {
  it('discovers .ts files and skips node_modules', async () => {
    const files = await discoverFiles({
      root: FIXTURE,
      include: [],
      exclude: [],
      ignore: { useGitignore: true, useDefaultPatterns: true, customPatterns: [] },
      maxFileSizeBytes: 1_000_000,
    });
    const paths = files.map(f => f.path);
    expect(paths).toContain('src/index.ts');
    expect(paths).toContain('src/auth/login.ts');
    expect(paths).toContain('src/api/routes.ts');
    expect(paths.some(p => p.includes('node_modules'))).toBe(false);
  });

  it('returns files in a stable path-sorted order', async () => {
    const opts = {
      root: FIXTURE,
      include: [],
      exclude: [],
      ignore: { useGitignore: true, useDefaultPatterns: true, customPatterns: [] },
      maxFileSizeBytes: 1_000_000,
    };
    const paths = (await discoverFiles(opts)).map(f => f.path);

    expect(paths).toEqual([...paths].sort());
  });

  it('sets isBinary false for .ts files', async () => {
    const files = await discoverFiles({
      root: FIXTURE,
      include: [],
      exclude: [],
      ignore: { useGitignore: false, useDefaultPatterns: false, customPatterns: [] },
      maxFileSizeBytes: 1_000_000,
    });
    const ts = files.find(f => f.path.endsWith('login.ts'));
    expect(ts?.isBinary).toBe(false);
  });

  it('respects include patterns', async () => {
    const files = await discoverFiles({
      root: FIXTURE,
      include: ['src/auth/**'],
      exclude: [],
      ignore: { useGitignore: false, useDefaultPatterns: false, customPatterns: [] },
      maxFileSizeBytes: 1_000_000,
    });
    expect(files.every(f => f.path.startsWith('src/auth/'))).toBe(true);
  });

  it('never walks into node_modules even when it contains many files', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const p = await import('path');
    const tmpDir = fs.mkdtempSync(p.join(os.tmpdir(), 'cc-nodemod-'));
    fs.writeFileSync(p.join(tmpDir, 'index.ts'), 'export const a = 1;\n');
    fs.mkdirSync(p.join(tmpDir, 'node_modules', 'some-dep'), { recursive: true });
    fs.writeFileSync(p.join(tmpDir, 'node_modules', 'some-dep', 'index.js'), 'module.exports = {};\n');
    const files = await discoverFiles({
      root: tmpDir,
      include: [],
      exclude: [],
      ignore: { useGitignore: false, useDefaultPatterns: true, customPatterns: [] },
      maxFileSizeBytes: 1_000_000,
    });
    expect(files.map(f => f.path)).toEqual(['index.ts']);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('respects gitignore negation patterns (rescues a file re-included after a broader exclude)', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const p = await import('path');
    const tmpDir = fs.mkdtempSync(p.join(os.tmpdir(), 'cc-negation-'));
    fs.writeFileSync(p.join(tmpDir, '.gitignore'), '*.log\n!important.log\n');
    fs.writeFileSync(p.join(tmpDir, 'a.log'), 'a\n');
    fs.writeFileSync(p.join(tmpDir, 'important.log'), 'important\n');
    fs.writeFileSync(p.join(tmpDir, 'keep.ts'), 'export const a = 1;\n');
    const files = await discoverFiles({
      root: tmpDir,
      include: [],
      exclude: [],
      ignore: { useGitignore: true, useDefaultPatterns: false, customPatterns: [] },
      maxFileSizeBytes: 1_000_000,
    });
    expect(files.map(f => f.path).sort()).toEqual(['important.log', 'keep.ts']);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
