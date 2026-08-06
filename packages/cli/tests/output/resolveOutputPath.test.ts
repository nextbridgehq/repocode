import { describe, it, expect } from 'vitest';
import path from 'path';
import { resolveOutputPath } from '../../src/output/resolveOutputPath.js';

describe('resolveOutputPath', () => {
  it('returns an absolute POSIX-style path unchanged regardless of baseDir', () => {
    const result = resolveOutputPath('/some/base', '/abs/output.xml');
    expect(result).toBe('/abs/output.xml');
  });

  it.skipIf(process.platform !== 'win32')('returns an absolute Windows-style path unchanged regardless of baseDir', () => {
    const result = resolveOutputPath('/some/base', 'C:\\abs\\output.xml');
    expect(result).toBe('C:\\abs\\output.xml');
  });

  it('resolves a relative path against baseDir', () => {
    const result = resolveOutputPath('/some/base', 'out.xml');
    expect(result).toBe(path.resolve('/some/base', 'out.xml'));
  });

  it('resolves a relative path with subdirectories against baseDir', () => {
    const result = resolveOutputPath('/some/base', 'sub/out.xml');
    expect(result).toBe(path.resolve('/some/base', 'sub/out.xml'));
  });

  it('resolves the default filename against baseDir', () => {
    const result = resolveOutputPath('/some/base', 'repocode-output.xml');
    expect(result).toBe(path.resolve('/some/base', 'repocode-output.xml'));
  });
});
