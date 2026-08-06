export function parseRemoteSpec(value: string): { owner: string; repo: string } {
  const urlMatch = value.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }
  const shorthandMatch = value.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (shorthandMatch) {
    return { owner: shorthandMatch[1], repo: shorthandMatch[2] };
  }
  throw new Error(`Invalid --remote value: "${value}". Expected "owner/repo" or a GitHub URL.`);
}

import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import * as tar from 'tar';

export interface ResolveRemoteOptions {
  owner: string;
  repo: string;
  branch?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

function authHeaders(token?: string): HeadersInit | undefined {
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

async function resolveBranch(
  owner: string,
  repo: string,
  branch: string | undefined,
  token: string | undefined,
  fetchImpl: typeof fetch,
): Promise<string> {
  if (branch) return branch;

  const res = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: authHeaders(token),
  });
  if (res.status === 404) {
    throw new Error(
      `Repo not found or private: ${owner}/${repo} — check the name, or set GITHUB_TOKEN / --remote-token for private repos.`
    );
  }
  if (!res.ok) {
    throw new Error(`Failed to resolve ${owner}/${repo} via the GitHub API: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { default_branch: string };
  return data.default_branch;
}

/** Reject archive entries that could escape the extraction directory: absolute
 *  paths, Windows drive letters, and any '..' segment. Checked against the raw
 *  archive path, so it holds regardless of how `strip` rewrites it. */
export function isContainedEntry(entryPath: string): boolean {
  const normalized = entryPath.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(normalized)) return false;
  return !normalized.split('/').includes('..');
}

export async function resolveRemote(options: ResolveRemoteOptions): Promise<string> {
  const { owner, repo, token } = options;
  const fetchImpl = options.fetchImpl ?? fetch;

  const branch = await resolveBranch(owner, repo, options.branch, token, fetchImpl);


  const tarballUrl = `https://codeload.github.com/${owner}/${repo}/tar.gz/refs/heads/${branch}`;
  const res = await fetchImpl(tarballUrl, { headers: authHeaders(token) });
  if (res.status === 404) {
    throw new Error(`Branch "${branch}" not found on ${owner}/${repo}.`);
  }
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download tarball for ${owner}/${repo}#${branch}: HTTP ${res.status}`);
  }

  const extractDir = await mkdtemp(join(tmpdir(), 'repocode-remote-'));
  try {
    await new Promise<void>((resolvePromise, reject) => {
      Readable.fromWeb(res.body as import('stream/web').ReadableStream)
        .pipe(tar.x({
          cwd: extractDir,
          strip: 1,
          // tar@7 already refuses absolute paths and '..' segments. Checking
          // explicitly is defence in depth: a future change to that default
          // cannot silently reopen a path-traversal hole here.
          filter: (entryPath: string) => isContainedEntry(entryPath),
        }))
        .on('finish', resolvePromise)
        .on('error', reject);
    });
  } catch (err) {
    await rm(extractDir, { recursive: true, force: true });
    throw new Error(`Failed to extract tarball for ${owner}/${repo}#${branch}: ${(err as Error).message}`);
  }

  return extractDir;
}
