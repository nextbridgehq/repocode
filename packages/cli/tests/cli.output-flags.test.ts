import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '../dist/cli.js');
const qCLI = `"${CLI}"`;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-output-flags-'));
  fs.mkdirSync(path.join(tmpDir, 'src', 'auth'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'src', 'api'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), "export { login } from './auth/login.js';\n");
  fs.writeFileSync(path.join(tmpDir, 'src', 'auth', 'login.ts'), 'export function login(user: string): boolean { return user.length > 0; }\n');
  fs.writeFileSync(path.join(tmpDir, 'src', 'api', 'routes.ts'), "export const routes = ['/login', '/logout'];\n");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('--output', () => {
  it('writes to the given filename instead of the default', () => {
    execSync(`node ${qCLI} "${tmpDir}" --output custom-name.xml --no-security`, { encoding: 'utf-8' });
    expect(fs.existsSync(path.join(tmpDir, 'custom-name.xml'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'repocode-output.xml'))).toBe(false);
  });
});

describe('--header', () => {
  it('prepends the given text inside <instructions>', () => {
    const out = execSync(`node ${qCLI} "${tmpDir}" --header "TEAM RULES: no any types" --no-security --stdout`, { encoding: 'utf-8' });
    expect(out).toContain('<instructions>');
    expect(out).toContain('TEAM RULES: no any types');
  });
});

describe('--no-preamble', () => {
  it('omits the preamble sentence that is present by default', () => {
    const withPreamble = execSync(`node ${qCLI} "${tmpDir}" --no-security --stdout`, { encoding: 'utf-8' });
    expect(withPreamble).toContain('This file contains source code');

    const withoutPreamble = execSync(`node ${qCLI} "${tmpDir}" --no-preamble --no-security --stdout`, { encoding: 'utf-8' });
    expect(withoutPreamble).not.toContain('This file contains source code');
  });
});

describe('--max-file-size', () => {
  it('excludes files larger than the given threshold', () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'big.ts'), 'export const blob = "' + 'x'.repeat(5000) + '";\n');
    const out = execSync(
      `node ${qCLI} "${tmpDir}" --max-file-size 200 --format json --no-security --stdout`,
      { encoding: 'utf-8' }
    );
    const parsed = JSON.parse(out);
    expect(parsed.files.some((f: { path: string }) => f.path.includes('big.ts'))).toBe(false);
  });

  it('accepts a k-suffixed size (e.g. 1k = 1000 bytes)', () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'big.ts'), 'export const blob = "' + 'x'.repeat(5000) + '";\n');
    const out = execSync(
      `node ${qCLI} "${tmpDir}" --max-file-size 1k --format json --no-security --stdout`,
      { encoding: 'utf-8' }
    );
    const parsed = JSON.parse(out);
    expect(parsed.files.some((f: { path: string }) => f.path.includes('big.ts'))).toBe(false);
  });
});

describe('--include', () => {
  it('restricts discovery to only the matching glob', () => {
    const out = execSync(
      `node ${qCLI} "${tmpDir}" --include "src/auth/**" --format json --no-security --stdout`,
      { encoding: 'utf-8' }
    );
    const parsed = JSON.parse(out);
    expect(parsed.files.length).toBeGreaterThan(0);
    expect(parsed.files.every((f: { path: string }) => f.path.startsWith('src/auth/'))).toBe(true);
  });
});

describe('--exclude', () => {
  it('removes matching files on top of the default walk', () => {
    const out = execSync(
      `node ${qCLI} "${tmpDir}" --exclude "src/api/**" --format json --no-security --stdout`,
      { encoding: 'utf-8' }
    );
    const parsed = JSON.parse(out);
    expect(parsed.files.some((f: { path: string }) => f.path.includes('routes.ts'))).toBe(false);
    expect(parsed.files.some((f: { path: string }) => f.path.includes('login.ts'))).toBe(true);
  });
});

describe('--pin', () => {
  it('force-includes a file even under a budget too small to normally fit it', () => {
    const out = execSync(
      `node ${qCLI} "${tmpDir}" --budget 1 --pin src/api/routes.ts --format json --no-security --stdout`,
      { encoding: 'utf-8' }
    );
    const parsed = JSON.parse(out);
    expect(parsed.files.some((f: { path: string }) => f.path.includes('routes.ts'))).toBe(true);
  });
});

describe('--dry-run', () => {
  it('writes no output file and prints a dry-run summary to stderr', () => {
    const result = spawnSync('node', [CLI, tmpDir, '--dry-run', '--no-security'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Dry run');
    expect(fs.existsSync(path.join(tmpDir, 'repocode-output.xml'))).toBe(false);
  });
});

describe('--verbose', () => {
  it('lists every excluded file instead of truncating at 20', () => {
    // A budget of 1 token pushes every candidate into result.excluded (reason: below-candidate-cut),
    // which is the list the 20-item cap and --verbose apply to (glob-excluded files never reach it).
    for (let i = 0; i < 25; i++) {
      fs.writeFileSync(path.join(tmpDir, `extra-${i}.ts`), `export const v${i} = ${i};\n`);
    }
    const withoutVerbose = spawnSync('node', [CLI, tmpDir, '--budget', '1', '--no-security'], { encoding: 'utf-8' });
    expect(withoutVerbose.stderr).toContain('more (--verbose to see all)');

    const withVerbose = spawnSync('node', [CLI, tmpDir, '--budget', '1', '--no-security', '--verbose'], { encoding: 'utf-8' });
    expect(withVerbose.stderr).not.toContain('more (--verbose to see all)');
    expect(withVerbose.stderr).toContain('extra-24.ts');
  });
});
