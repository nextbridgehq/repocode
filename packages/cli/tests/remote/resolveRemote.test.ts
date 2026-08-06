import { describe, it, expect, vi } from 'vitest';

describe('parseRemoteSpec', () => {
  it('parses owner/repo shorthand', async () => {
    const { parseRemoteSpec } = await import('../../src/remote/resolveRemote.js');
    expect(parseRemoteSpec('yamadashy/repomix')).toEqual({ owner: 'yamadashy', repo: 'repomix' });
  });

  it('parses a full GitHub URL', async () => {
    const { parseRemoteSpec } = await import('../../src/remote/resolveRemote.js');
    expect(parseRemoteSpec('https://github.com/yamadashy/repomix')).toEqual({ owner: 'yamadashy', repo: 'repomix' });
  });

  it('parses a full GitHub URL with a trailing .git', async () => {
    const { parseRemoteSpec } = await import('../../src/remote/resolveRemote.js');
    expect(parseRemoteSpec('https://github.com/yamadashy/repomix.git')).toEqual({ owner: 'yamadashy', repo: 'repomix' });
  });

  it('throws on an invalid spec', async () => {
    const { parseRemoteSpec } = await import('../../src/remote/resolveRemote.js');
    expect(() => parseRemoteSpec('not-a-valid-spec')).toThrow('Invalid --remote value: "not-a-valid-spec"');
  });
});

describe('resolveRemote — branch resolution and auth', () => {
  it('uses the explicit branch without calling the GitHub API', async () => {
    const { resolveRemote } = await import('../../src/remote/resolveRemote.js');
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      return new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 });
    }) as unknown as typeof fetch;

    // The mock stream closes immediately with zero bytes, which is not a
    // valid gzip/tar payload — tar.x() rejects it fast (~5ms, verified) with
    // TAR_BAD_ARCHIVE rather than hanging. We only care that no
    // api.github.com call happens before the tarball fetch — the tarball
    // extraction itself is covered by the real end-to-end test in Task 3 —
    // so this test only asserts on `calls` captured before that rejection.
    await resolveRemote({ owner: 'o', repo: 'r', branch: 'main', fetchImpl }).catch(() => {});
    expect(calls.some(u => u.includes('api.github.com'))).toBe(false);
    expect(calls.some(u => u.includes('codeload.github.com/o/r/tar.gz/refs/heads/main'))).toBe(true);
  });

  it('resolves the default branch via the GitHub API when no branch is given', async () => {
    const { resolveRemote } = await import('../../src/remote/resolveRemote.js');
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('api.github.com')) {
        return new Response(JSON.stringify({ default_branch: 'develop' }), { status: 200 });
      }
      return new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 });
    }) as unknown as typeof fetch;

    await resolveRemote({ owner: 'o', repo: 'r', fetchImpl }).catch(() => {});
    expect(calls[0]).toBe('https://api.github.com/repos/o/r');
    expect(calls.some(u => u.includes('codeload.github.com/o/r/tar.gz/refs/heads/develop'))).toBe(true);
  });

  it('sends an Authorization Bearer header on both requests when a token is given', async () => {
    const { resolveRemote } = await import('../../src/remote/resolveRemote.js');
    const headersSeen: (string | null)[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      headersSeen.push(h.get('Authorization'));
      const u = String(url);
      if (u.includes('api.github.com')) {
        return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 });
      }
      return new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 });
    }) as unknown as typeof fetch;

    await resolveRemote({ owner: 'o', repo: 'r', token: 'secret-token', fetchImpl }).catch(() => {});
    expect(headersSeen.every(h => h === 'Bearer secret-token')).toBe(true);
  });

  it('sends no Authorization header when no token is given', async () => {
    const { resolveRemote } = await import('../../src/remote/resolveRemote.js');
    const headersSeen: (string | null)[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      headersSeen.push(h.get('Authorization'));
      return new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 });
    }) as unknown as typeof fetch;

    await resolveRemote({ owner: 'o', repo: 'r', branch: 'main', fetchImpl }).catch(() => {});
    expect(headersSeen.every(h => h === null)).toBe(true);
  });
});

describe('resolveRemote — errors', () => {
  it('throws a repo-not-found-or-private message on a 404 from the API', async () => {
    const { resolveRemote } = await import('../../src/remote/resolveRemote.js');
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(resolveRemote({ owner: 'ghost', repo: 'nope', fetchImpl })).rejects.toThrow(
      'Repo not found or private: ghost/nope — check the name, or set GITHUB_TOKEN / --remote-token for private repos.'
    );
  });

  it('throws a branch-not-found message on a 404 from the tarball download', async () => {
    const { resolveRemote } = await import('../../src/remote/resolveRemote.js');
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('api.github.com')) {
        return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 });
      }
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    await expect(resolveRemote({ owner: 'o', repo: 'r', branch: 'nonexistent', fetchImpl })).rejects.toThrow(
      'Branch "nonexistent" not found on o/r.'
    );
  });

  it('never includes the token in a thrown error message', async () => {
    const { resolveRemote } = await import('../../src/remote/resolveRemote.js');
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(
      resolveRemote({ owner: 'ghost', repo: 'nope', token: 'super-secret-token-xyz', fetchImpl })
    ).rejects.not.toThrow(expect.stringContaining('super-secret-token-xyz'));
  });
});
