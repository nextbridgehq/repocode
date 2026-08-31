import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(__dirname, '..', 'dist', 'cli.js');

function run(...args: string[]) {
  return spawnSync(process.execPath, [cliEntry, ...args], { encoding: 'utf-8' });
}

// A representative flag from each tier. Core flags are the ones a first-time user reaches
// for (README quickstart); this one — --pr — is deliberately obscure enough that it would
// never be someone's first flag, so it stands in for "everything --help-advanced adds".
const CORE_FLAG = '--budget';
const ADVANCED_FLAG = '--pr';

describe('tiered --help', () => {
  it('--help shows core flags and fits roughly one screen', () => {
    const result = run('--help');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(CORE_FLAG);
    // "Roughly one screen": generous enough to survive re-wrapping from a description
    // edit, tight enough to fail if the tiering is accidentally removed and all ~50
    // flags come back.
    expect(result.stdout.split('\n').length).toBeLessThan(45);
  });

  it('--help omits advanced flags and points at --help-advanced', () => {
    const result = run('--help');
    expect(result.stdout).not.toContain(ADVANCED_FLAG);
    expect(result.stdout).toContain('--help-advanced');
  });

  it('--help-advanced shows both tiers, and nothing that was hidden stopped working', () => {
    const result = run('--help-advanced');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(CORE_FLAG);
    expect(result.stdout).toContain(ADVANCED_FLAG);
  });

  it('a hidden flag still parses and reaches its real validation', () => {
    // Confirms "nothing removed" isn't just true of --help text — the option itself
    // still exists on the command and does its job. --pr on a non-git directory fails
    // with the git-mode error, not a commander "unknown option" error.
    const dir = fs.mkdtempSync(join(os.tmpdir(), 'cc-help-tier-'));
    try {
      const result = run(dir, '--pr', '--explain');
      expect(result.status).not.toBe(0);
      expect(result.stderr).not.toContain('unknown option');
      expect(result.stderr).toContain('not a git repository');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
