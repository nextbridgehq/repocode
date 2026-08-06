import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig, savePreset, listUserPresets } from '../../src/config/loader.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-preset-'));
});

afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

function writeConfig(obj: object): void {
  fs.writeFileSync(path.join(tmpDir, 'repocode.config.json'), JSON.stringify(obj, null, 2));
}

describe('loadConfig with preset', () => {
  it('applies user preset between file config and CLI overrides', async () => {
    writeConfig({
      budget: { maxTokens: 80_000 },
      presets: {
        frontend: { compress: 'tier2-structural', budget: { maxTokens: 60_000 } },
      },
    });
    const config = await loadConfig(tmpDir, { verbose: true }, { preset: 'frontend' });
    expect(config.compress).toBe('tier2-structural');
    expect(config.budget.maxTokens).toBe(60_000);
    expect(config.verbose).toBe(true); // CLI override
  });

  it('CLI overrides beat preset values', async () => {
    writeConfig({ presets: { small: { budget: { maxTokens: 40_000 } } } });
    const config = await loadConfig(tmpDir, { budget: { maxTokens: 200_000 } }, { preset: 'small' });
    expect(config.budget.maxTokens).toBe(200_000);
  });

  it('preset git object deep-merges with base git config', async () => {
    writeConfig({
      git: { mode: 'log', n: 5, deps: true },
      presets: { review: { git: { mode: 'diff' } } },
    });
    const config = await loadConfig(tmpDir, {}, { preset: 'review' });
    expect(config.git?.mode).toBe('diff');    // preset overrides
    expect(config.git?.n).toBe(5);            // preserved from file config
  });

  it('built-in preset "full" sets compress to none', async () => {
    writeConfig({});
    const config = await loadConfig(tmpDir, {}, { preset: 'full' });
    expect(config.compress).toBe('none');
  });

  it('user preset shadows built-in of same name', async () => {
    writeConfig({ presets: { full: { compress: 'tier1-regex' } } });
    const config = await loadConfig(tmpDir, {}, { preset: 'full' });
    expect(config.compress).toBe('tier1-regex'); // user wins
  });

  it('throws with available names on unknown preset', async () => {
    writeConfig({ presets: { mine: {} } });
    await expect(loadConfig(tmpDir, {}, { preset: 'nope' })).rejects.toThrow(/Unknown preset "nope"/);
    await expect(loadConfig(tmpDir, {}, { preset: 'nope' })).rejects.toThrow(/mine/);
  });

  it('description is stripped — not present in resolved config', async () => {
    writeConfig({ presets: { x: { description: 'My preset', compress: 'none' } } });
    const config = await loadConfig(tmpDir, {}, { preset: 'x' }) as Record<string, unknown>;
    expect(config['description']).toBeUndefined();
  });
});

describe('savePreset', () => {
  it('writes preset into existing config file', () => {
    writeConfig({ budget: { maxTokens: 50_000 } });
    savePreset('api', { compress: 'tier1-regex' }, tmpDir);
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'repocode.config.json'), 'utf-8'));
    expect(saved.presets.api.compress).toBe('tier1-regex');
    expect(saved.budget.maxTokens).toBe(50_000); // existing key preserved
  });

  it('creates minimal config file with only presets key when file is absent', () => {
    savePreset('mine', { compress: 'none' }, tmpDir);
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'repocode.config.json'), 'utf-8'));
    expect(Object.keys(saved)).toEqual(['presets']); // only presets key
    expect(saved.presets.mine.compress).toBe('none');
  });

  it('auto-adds a description with the save date', () => {
    savePreset('dated', {}, tmpDir);
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'repocode.config.json'), 'utf-8'));
    expect(saved.presets.dated.description).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('listUserPresets', () => {
  it('returns user presets and built-ins separately', () => {
    writeConfig({ presets: { mine: { compress: 'none' } } });
    const { user, builtin } = listUserPresets(tmpDir);
    expect(user['mine']).toBeDefined();
    expect(builtin['full']).toBeDefined();
    expect(builtin['minimal']).toBeDefined();
    expect(builtin['review']).toBeDefined();
  });

  it('returns empty user presets when no config file exists', () => {
    const { user } = listUserPresets(tmpDir);
    expect(Object.keys(user)).toHaveLength(0);
  });
});

// Sanity: DEFAULT_CONFIG is not accidentally mutated
describe('DEFAULT_CONFIG immutability', () => {
  it('loadConfig does not mutate DEFAULT_CONFIG', async () => {
    const originalTokens = DEFAULT_CONFIG.budget.maxTokens;
    writeConfig({ budget: { maxTokens: 999_999 } });
    await loadConfig(tmpDir, {});
    expect(DEFAULT_CONFIG.budget.maxTokens).toBe(originalTokens);
  });
});

describe('built-in language presets', () => {
  it('ts-library excludes generated declarations and build info', async () => {
    writeConfig({});
    const config = await loadConfig(tmpDir, {}, { preset: 'ts-library' });
    expect(config.exclude).toEqual(['**/*.d.ts', '**/*.tsbuildinfo']);
  });

  it('py-service excludes venvs, bytecode caches, and egg-info', async () => {
    writeConfig({});
    const config = await loadConfig(tmpDir, {}, { preset: 'py-service' });
    expect(config.exclude).toEqual(['.venv/**', 'venv/**', '**/__pycache__/**', '**/*.pyc', '**/*.egg-info/**']);
  });

  it('go-service excludes vendored dependencies', async () => {
    writeConfig({});
    const config = await loadConfig(tmpDir, {}, { preset: 'go-service' });
    expect(config.exclude).toEqual(['vendor/**']);
  });

  it('rust-crate excludes the target build directory', async () => {
    writeConfig({});
    const config = await loadConfig(tmpDir, {}, { preset: 'rust-crate' });
    expect(config.exclude).toEqual(['target/**']);
  });

  it('java-maven excludes build output, classes, and jars', async () => {
    writeConfig({});
    const config = await loadConfig(tmpDir, {}, { preset: 'java-maven' });
    expect(config.exclude).toEqual(['target/**', '**/*.class', '**/*.jar']);
  });

  it('all 5 language presets are listed as built-ins, each with a description', () => {
    const { builtin } = listUserPresets(tmpDir);
    for (const name of ['ts-library', 'py-service', 'go-service', 'rust-crate', 'java-maven']) {
      expect(builtin[name]).toBeDefined();
      expect((builtin[name] as { description?: string }).description).toBeTruthy();
    }
  });
});
