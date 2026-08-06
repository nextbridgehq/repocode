import { describe, it, expect } from 'vitest';
import { isContainedEntry } from '../../src/remote/resolveRemote.js';

describe('isContainedEntry (tarball path traversal guard)', () => {
  it('accepts ordinary repository paths', () => {
    expect(isContainedEntry('repo-main/src/index.ts')).toBe(true);
    expect(isContainedEntry('repo-main/README.md')).toBe(true);
    expect(isContainedEntry('repo-main/a/b/c/d.txt')).toBe(true);
    expect(isContainedEntry('repo-main/weird..name.ts')).toBe(true);
    expect(isContainedEntry('repo-main/..hidden')).toBe(true);
  });

  it('rejects parent-directory traversal', () => {
    expect(isContainedEntry('repo-main/../../etc/passwd')).toBe(false);
    expect(isContainedEntry('../escape.txt')).toBe(false);
    expect(isContainedEntry('a/../../b')).toBe(false);
  });

  it('rejects absolute paths', () => {
    expect(isContainedEntry('/etc/passwd')).toBe(false);
    expect(isContainedEntry('/tmp/evil')).toBe(false);
  });

  it('rejects Windows drive-qualified paths', () => {
    expect(isContainedEntry('C:/Windows/System32/evil.dll')).toBe(false);
    expect(isContainedEntry('C:\\Windows\\System32\\evil.dll')).toBe(false);
  });

  it('rejects backslash-separated traversal', () => {
    // A tarball can carry backslashes in entry names; normalising first means
    // they cannot be used to sneak a '..' segment past the check.
    expect(isContainedEntry('repo-main\\..\\..\\etc\\passwd')).toBe(false);
  });
});
