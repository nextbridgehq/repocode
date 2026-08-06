import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { savePreset, listUserPresets } from '@repocode/core';

let tmpDir: string;

beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cli-preset-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe('savePreset helper (via core)', () => {
  it('saves only provided fields as a preset', () => {
    savePreset('ci', { compress: 'tier1-regex', verbose: true }, tmpDir);
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'repocode.config.json'), 'utf-8'));
    expect(saved.presets.ci.compress).toBe('tier1-regex');
    expect(saved.presets.ci.verbose).toBe(true);
    // Should NOT contain root or other defaults
    expect(saved.presets.ci.root).toBeUndefined();
  });
});

describe('listUserPresets helper (via core)', () => {
  it('returns built-in presets even with no config file', () => {
    const { builtin } = listUserPresets(tmpDir);
    expect(builtin['full']).toBeDefined();
    expect(builtin['minimal']).toBeDefined();
    expect(builtin['review']).toBeDefined();
  });

  it('returns user presets from config file', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'repocode.config.json'),
      JSON.stringify({ presets: { mypreset: { compress: 'none' } } })
    );
    const { user } = listUserPresets(tmpDir);
    expect(user['mypreset']?.compress).toBe('none');
  });
});
