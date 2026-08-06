import { describe, it, expect, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { registerGetFile } from '../src/resources/getFile.js';

async function makeClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerGetFile(server);
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

describe('get_file resource — symlink escape', () => {
  let client: Awaited<ReturnType<typeof makeClient>>;
  let tmpDir: string;
  let cannotCreateSymlink = false;

  afterEach(async () => {
    await client?.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects a symlink that points outside the repo root', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-symlink-'));
    const repoDir = path.join(tmpDir, 'repo');
    const secretFile = path.join(tmpDir, 'secret.txt');
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(secretFile, 'TOP SECRET');

    // On Windows, symlink creation may require elevated privileges or Developer Mode
    try {
      fs.symlinkSync(secretFile, path.join(repoDir, 'link.txt'));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') {
        cannotCreateSymlink = true;
      } else {
        throw err;
      }
    }

    if (cannotCreateSymlink) {
      // Skip: cannot create symlinks without elevated privileges on this system
      return;
    }

    client = await makeClient();
    const encodedRepo = encodeURIComponent(repoDir);

    // The server should throw a McpError, so readResource should reject
    let errorThrown = false;
    try {
      const result = await client.readResource({
        uri: `repocode:///${encodedRepo}/file/link.txt`,
      });
      // If it didn't throw, verify the secret is not in any content
      const contents = result.contents as Array<{ text?: string }>;
      expect(contents.every(c => !c.text?.includes('TOP SECRET'))).toBe(true);
    } catch (err) {
      errorThrown = true;
      // McpError was thrown — the path escape was blocked
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain('TOP SECRET');
      expect(message.toLowerCase()).toMatch(/symlink|escapes|resolve|cannot/);
    }

    // The security check must have thrown — both branches reaching here means the error was taken
    expect(errorThrown).toBe(true);
  });

  it('allows reading a normal file inside the repo root', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-normal-'));
    const repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'hello.ts'), 'const x = 1;');

    client = await makeClient();
    const encodedRepo = encodeURIComponent(repoDir);

    const result = await client.readResource({
      uri: `repocode:///${encodedRepo}/file/hello.ts`,
    });
    const contents = result.contents as Array<{ text?: string }>;
    expect(contents.some(c => c.text?.includes('const x = 1;'))).toBe(true);
  });

  it('rejects a read when the resolved path is swapped for a symlink after the initial check', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-swap-'));
    const repoDir = path.join(tmpDir, 'repo');
    const outsideFile = path.join(tmpDir, 'outside.txt');
    const realFilePath = path.join(repoDir, 'real.ts');
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(realFilePath, 'const x = 1;');
    fs.writeFileSync(outsideFile, 'SWAPPED CONTENT');

    client = await makeClient();
    const encodedRepo = encodeURIComponent(repoDir);

    // Sanity check: reading the real file works before any swap occurs.
    const before = await client.readResource({
      uri: `repocode:///${encodedRepo}/file/real.ts`,
    });
    const beforeContents = before.contents as Array<{ text?: string }>;
    expect(beforeContents.some(c => c.text?.includes('const x = 1;'))).toBe(true);

    // Simulate the TOCTOU swap: the path that was a plain file is now a symlink,
    // as if an attacker replaced it between the check and the read.
    fs.rmSync(realFilePath);
    try {
      fs.symlinkSync(outsideFile, realFilePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') return; // no symlink privileges on this system
      throw err;
    }

    let errorThrown = false;
    try {
      await client.readResource({ uri: `repocode:///${encodedRepo}/file/real.ts` });
    } catch {
      errorThrown = true;
    }
    // On POSIX, O_NOFOLLOW at open() rejects the now-swapped-in symlink.
    // On Windows the O_NOFOLLOW flag is not applied (see implementation), so this assertion is scoped
    // to platforms where the hardening is active.
    if (process.platform !== 'win32') {
      expect(errorThrown).toBe(true);
    }
  });
});
