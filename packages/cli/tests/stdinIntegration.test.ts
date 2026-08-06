import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = path.join(__dirname, '..', 'dist', 'cli.js');

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'stdin-integration-'));
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'included.ts'), 'export const included = true;\n');
  writeFileSync(path.join(root, 'src', 'excluded.ts'), 'export const excluded = true;\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('--stdin end-to-end', () => {
  it('packs only the files piped in, not the whole directory', () => {
    const result = spawnSync(process.execPath, [cliEntry, root, '--stdin', '--stdout', '--no-security'], {
      input: 'src/included.ts\n',
      encoding: 'utf-8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('included.ts');
    expect(result.stdout).toContain('export const included = true;');
    expect(result.stdout).not.toContain('excluded.ts');
  });
});
