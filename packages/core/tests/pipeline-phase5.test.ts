import { describe, it, expect } from 'vitest';
import { runPipelineForTUI, loadConfig } from '../src/index.js';
import { DEFAULT_CONFIG } from '../src/config/defaults.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

let fixtureDir: string;

function setup(): void {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-phase5-'));
  fs.writeFileSync(path.join(fixtureDir, 'hub.ts'), `export const hub = 1;\n`);
  fs.writeFileSync(path.join(fixtureDir, 'leaf.ts'), `export const leaf = 2;\n`);
  fs.writeFileSync(path.join(fixtureDir, 'importer.ts'), `import { hub } from './hub.js';\n`);
}

function teardown(): void {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
}

describe('runPipelineForTUI', () => {
  it('returns files sorted by score desc with content and tokens', async () => {
    setup();
    try {
      const config = await loadConfig(fixtureDir, {
        ...DEFAULT_CONFIG, root: fixtureDir, graphDepth: 2,
        security: { enabled: false, mode: 'warn' },
      });
      const result = await runPipelineForTUI(config);
      expect(result.files.length).toBeGreaterThan(0);
      for (let i = 1; i < result.files.length; i++) {
        expect(result.files[i - 1].score).toBeGreaterThanOrEqual(result.files[i].score);
      }
      for (const f of result.files) {
        expect(typeof f.content).toBe('string');
        expect(f.tokens).toBeGreaterThan(0);
      }
    } finally { teardown(); }
  });

  it('imports map contains resolved adjacency edges', async () => {
    setup();
    try {
      const config = await loadConfig(fixtureDir, {
        ...DEFAULT_CONFIG, root: fixtureDir, graphDepth: 2,
        security: { enabled: false, mode: 'warn' },
      });
      const result = await runPipelineForTUI(config);
      const deps = result.imports.get('importer.ts');
      expect(deps).toBeDefined();
      expect(deps).toContain('hub.ts');
    } finally { teardown(); }
  });

  it('graphDepth: 0 returns empty imports map', async () => {
    setup();
    try {
      const config = await loadConfig(fixtureDir, {
        ...DEFAULT_CONFIG, root: fixtureDir, graphDepth: 0,
        security: { enabled: false, mode: 'warn' },
      });
      const result = await runPipelineForTUI(config);
      expect(result.imports.size).toBe(0);
    } finally { teardown(); }
  });
});
