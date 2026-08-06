import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runPipeline } from '../src/pipeline.js';
import type { RepoCodeConfig } from '../src/types.js';
import { DEFAULT_CONFIG } from '../src/config/defaults.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('pipeline integration - maxCandidates', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repocode-maxcand-test-'));
    
    // Create 10 files
    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(path.join(tmpDir, `file${i}.ts`), `export const x${i} = ${i};\n`);
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const testConfig: RepoCodeConfig = {
    ...DEFAULT_CONFIG,
    output: { ...DEFAULT_CONFIG.output, format: 'json', preamble: false },
    budget: { maxTokens: 100_000, reserveForResponse: 0, reserveForPrompt: 0 },
    security: { enabled: false, mode: 'warn' },
  };

  it('limits unpinned files to maxCandidates', async () => {
    const config: RepoCodeConfig = {
      ...testConfig,
      root: tmpDir,
      maxCandidates: 3,
      ranking: { ...DEFAULT_CONFIG.ranking, pinned: [] },
    };

    const result = await runPipeline(config);
    expect(result.included.length).toBe(3);
  });

  it('pinned files bypass maxCandidates cap', async () => {
    const config: RepoCodeConfig = {
      ...testConfig,
      root: tmpDir,
      maxCandidates: 3,
      // Pin two files
      ranking: { ...DEFAULT_CONFIG.ranking, pinned: ['file1.ts', 'file2.ts'] },
    };

    const result = await runPipeline(config);
    
    // 3 unpinned + 2 pinned = 5 files
    expect(result.included.length).toBe(5);
    
    // Ensure pinned files are actually included
    const includedNames = result.included.map(f => path.basename(f.path));
    expect(includedNames).toContain('file1.ts');
    expect(includedNames).toContain('file2.ts');
  });
});
