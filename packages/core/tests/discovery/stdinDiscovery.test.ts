import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'stdin-discovery-test-'));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'index.ts'), 'export const x = 1;\n');
  writeFileSync(path.join(root, 'README.md'), '# hello\n');
  writeFileSync(path.join(root, '.gitignore'), 'node_modules/\nignored-file.txt\n');
  writeFileSync(path.join(root, 'ignored-file.txt'), 'should still be included via stdin\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('stdinDiscovery', () => {
  it('resolves relative paths against root and classifies language/binary', async () => {
    const { stdinDiscovery } = await import('../../src/discovery/stdinDiscovery.js');
    const { files, excluded } = await stdinDiscovery(['src/index.ts', 'README.md'], root);
    expect(excluded).toHaveLength(0);
    expect(files).toHaveLength(2);
    const indexFile = files.find(f => f.path === 'src/index.ts');
    expect(indexFile).toBeDefined();
    expect(indexFile!.language).toBe('typescript');
    expect(indexFile!.isBinary).toBe(false);
    expect(indexFile!.absolutePath).toBe(path.join(root, 'src', 'index.ts'));
  });

  it('resolves absolute paths that fall within root', async () => {
    const { stdinDiscovery } = await import('../../src/discovery/stdinDiscovery.js');
    const absPath = path.join(root, 'README.md');
    const { files, excluded } = await stdinDiscovery([absPath], root);
    expect(excluded).toHaveLength(0);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('README.md');
  });

  it('does NOT apply ignore-pattern filtering — a gitignored file passed via stdin is included', async () => {
    const { stdinDiscovery } = await import('../../src/discovery/stdinDiscovery.js');
    const { files, excluded } = await stdinDiscovery(['ignored-file.txt'], root);
    expect(excluded).toHaveLength(0);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('ignored-file.txt');
  });

  it('skips and reports a path that does not exist on disk', async () => {
    const { stdinDiscovery } = await import('../../src/discovery/stdinDiscovery.js');
    const { files, excluded } = await stdinDiscovery(['src/does-not-exist.ts'], root);
    expect(files).toHaveLength(0);
    expect(excluded).toHaveLength(1);
    expect(excluded[0]).toEqual({ path: 'src/does-not-exist.ts', reason: 'not-found' });
  });

  it('skips and reports a path that resolves outside root', async () => {
    const { stdinDiscovery } = await import('../../src/discovery/stdinDiscovery.js');
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'stdin-discovery-outside-'));
    try {
      writeFileSync(path.join(outsideDir, 'escaped.ts'), 'x\n');
      const { files, excluded } = await stdinDiscovery([path.join(outsideDir, 'escaped.ts')], root);
      expect(files).toHaveLength(0);
      expect(excluded).toHaveLength(1);
      expect(excluded[0].reason).toBe('outside-root');
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('processes a mix of valid, missing, and outside-root paths in one call', async () => {
    const { stdinDiscovery } = await import('../../src/discovery/stdinDiscovery.js');
    const { files, excluded } = await stdinDiscovery(
      ['src/index.ts', 'src/nope.ts', 'README.md'],
      root,
    );
    expect(files.map(f => f.path).sort()).toEqual(['README.md', 'src/index.ts']);
    expect(excluded).toEqual([{ path: 'src/nope.ts', reason: 'not-found' }]);
  });

  it('skips and reports a directory piped in as if it were a file', async () => {
    const { stdinDiscovery } = await import('../../src/discovery/stdinDiscovery.js');
    const { files, excluded } = await stdinDiscovery(['src'], root);
    expect(files).toHaveLength(0);
    expect(excluded).toEqual([{ path: 'src', reason: 'not-found' }]);
  });

  it('skips and reports root itself when piped in as "."', async () => {
    const { stdinDiscovery } = await import('../../src/discovery/stdinDiscovery.js');
    const { files, excluded } = await stdinDiscovery(['.'], root);
    expect(files).toHaveLength(0);
    expect(excluded).toEqual([{ path: '.', reason: 'not-found' }]);
  });
});
