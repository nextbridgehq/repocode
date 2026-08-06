import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '../dist/cli.js');

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-presets-e2e-'));
  fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'export const a = 1;\n');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('--list-presets', () => {
  it('lists the built-in presets and exits without packing', () => {
    const result = spawnSync('node', [CLI, tmpDir, '--list-presets'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('full');
    expect(result.stdout).toContain('minimal');
    expect(result.stdout).toContain('review');
    expect(fs.existsSync(path.join(tmpDir, 'repocode-output.xml'))).toBe(false);
  });

  it('also lists user presets defined in repocode.config.json, under their own section', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'repocode.config.json'),
      JSON.stringify({ presets: { mypreset: { description: 'my custom preset', compress: 'none' } } })
    );
    const result = spawnSync('node', [CLI, tmpDir, '--list-presets'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('User presets');
    expect(result.stdout).toContain('mypreset');
    expect(result.stdout).toContain('my custom preset');
  });
});

describe('--save-preset', () => {
  it('persists the current flags as a named preset and exits without packing', () => {
    const result = spawnSync('node', [CLI, tmpDir, '--budget', '12345', '--compress', 'tier1', '--save-preset', 'myci'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Saved preset "myci"');
    expect(fs.existsSync(path.join(tmpDir, 'repocode-output.xml'))).toBe(false);

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'repocode.config.json'), 'utf-8'));
    expect(saved.presets.myci.budget.maxTokens).toBe(12345);
    expect(saved.presets.myci.compress).toBe('tier1-regex');
  });

  it('a saved preset can later be activated with --preset', () => {
    spawnSync('node', [CLI, tmpDir, '--budget', '55555', '--save-preset', 'roundtrip'], { encoding: 'utf-8' });

    const result = spawnSync('node', [CLI, tmpDir, '--preset', 'roundtrip', '--no-security', '--format', 'json', '--stdout'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.metadata.budget).toBe(55555);
  });
});

describe('--preset', () => {
  it('activates a built-in preset (minimal: 40,000 token budget)', () => {
    const result = spawnSync('node', [CLI, tmpDir, '--preset', 'minimal', '--no-security', '--format', 'json', '--stdout'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.metadata.budget).toBe(40000);
  });

  it('an explicit CLI flag still overrides the preset value', () => {
    const result = spawnSync('node', [CLI, tmpDir, '--preset', 'minimal', '--budget', '99999', '--no-security', '--format', 'json', '--stdout'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.metadata.budget).toBe(99999);
  });

  it('an unknown preset name fails with a clear message', () => {
    const result = spawnSync('node', [CLI, tmpDir, '--preset', 'not-a-real-preset', '--no-security'], { encoding: 'utf-8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown preset "not-a-real-preset"');
  });
});

describe('--profile validation', () => {
  it('rejects --profile without --interactive', () => {
    const result = spawnSync('node', [CLI, tmpDir, '--profile', 'work', '--no-security'], { encoding: 'utf-8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--profile requires --interactive');
  });
});
