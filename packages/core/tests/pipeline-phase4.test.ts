import { describe, it, expect } from 'vitest';
import { runPipeline, loadConfig } from '../src/index.js';
import { DEFAULT_CONFIG } from '../src/config/defaults.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

let fixtureDir: string;

function setup(): void {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-phase4-'));

  // hub.ts: imported by 3 files → high in-degree → high centrality
  fs.writeFileSync(path.join(fixtureDir, 'hub.ts'), `export const hub = 1;\n`);

  // leaf.ts: not imported by anyone → in-degree 0 → centrality 0
  fs.writeFileSync(path.join(fixtureDir, 'leaf.ts'), `export const leaf = 2;\n`);

  // Three importers of hub.ts
  fs.writeFileSync(path.join(fixtureDir, 'i1.ts'), `import { hub } from './hub.js'; export const i1 = hub;\n`);
  fs.writeFileSync(path.join(fixtureDir, 'i2.ts'), `import { hub } from './hub.js'; export const i2 = hub;\n`);
  fs.writeFileSync(path.join(fixtureDir, 'i3.ts'), `import { hub } from './hub.js'; export const i3 = hub;\n`);
}

function teardown(): void {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
}

describe('Phase 4A pipeline integration', () => {
  it('hub.ts (high in-degree) ranks above leaf.ts (in-degree 0) with graphDepth: 2', async () => {
    setup();
    try {
      const config = await loadConfig(fixtureDir, {
        ...DEFAULT_CONFIG,
        root: fixtureDir,
        graphDepth: 2,
        budget: { maxTokens: 10_000, reserveForResponse: 0, reserveForPrompt: 0 },
        compress: 'none',
        security: { enabled: false, mode: 'warn' },
      });
      const result = await runPipeline(config);
      const paths = result.included.map(f => f.path);
      expect(paths.indexOf('hub.ts')).toBeLessThan(paths.indexOf('leaf.ts'));
    } finally {
      teardown();
    }
  });

  it('graphDepth: 0 disables graph — pipeline still creates cache.json (runPipeline self-manages its own cache)', async () => {
    setup();
    try {
      const config = await loadConfig(fixtureDir, {
        ...DEFAULT_CONFIG,
        root: fixtureDir,
        graphDepth: 0,
        budget: { maxTokens: 10_000, reserveForResponse: 0, reserveForPrompt: 0 },
        compress: 'none',
        security: { enabled: false, mode: 'warn' },
      });
      const result = await runPipeline(config);
      expect(result.included.length).toBeGreaterThan(0);
      // As of Task 4 (Phase 7), runPipeline always loads/uses/saves its own FileCache
      // instance for accurate-token caching when no external cache is passed in,
      // independent of whether buildGraph (gated on graphDepth > 0) runs.
      const cachePath = path.join(fixtureDir, '.repocode', 'cache.json');
      expect(fs.existsSync(cachePath)).toBe(true);
    } finally {
      teardown();
    }
  });

  it('cache created at .repocode/cache.json after first run with graphDepth: 2', async () => {
    setup();
    try {
      const config = await loadConfig(fixtureDir, {
        ...DEFAULT_CONFIG,
        root: fixtureDir,
        graphDepth: 2,
        budget: { maxTokens: 10_000, reserveForResponse: 0, reserveForPrompt: 0 },
        compress: 'none',
        security: { enabled: false, mode: 'warn' },
      });
      await runPipeline(config);
      const cachePath = path.join(fixtureDir, '.repocode', 'cache.json');
      expect(fs.existsSync(cachePath)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      expect(parsed.version).toBe(3);
      expect(typeof parsed.files).toBe('object');
    } finally {
      teardown();
    }
  });

  it('centrality applies in normal mode (no config.git) — hub.ts ranks above leaf.ts', async () => {
    setup();
    try {
      const config = await loadConfig(fixtureDir, {
        ...DEFAULT_CONFIG,
        root: fixtureDir,
        graphDepth: 2,
        budget: { maxTokens: 10_000, reserveForResponse: 0, reserveForPrompt: 0 },
        compress: 'none',
        security: { enabled: false, mode: 'warn' },
        // No git field → normal discovery mode
      });
      const result = await runPipeline(config);
      expect(result.included.length).toBeGreaterThan(0);
      const paths = result.included.map(f => f.path);
      expect(paths.indexOf('hub.ts')).toBeLessThan(paths.indexOf('leaf.ts'));
    } finally {
      teardown();
    }
  });
});
