import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { goResolver } from '../../src/languageResolvers/go.js';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-go-'));
  fs.mkdirSync(path.join(tmpDir, 'internal', 'config'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'internal', 'config', 'settings.go'), 'package config');
});

afterAll(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe('goResolver', () => {
  it('extractImports: captures import block paths', () => {
    const content = 'import (\n"fmt"\n"github.com/myapp/internal/config"\n)';
    const specs = goResolver.extractImports(content, 'main.go');
    expect(specs).toContain('github.com/myapp/internal/config');
  });

  it('resolveImport: resolves to directory path if exists under root', () => {
    const result = goResolver.resolveImport('github.com/myapp/internal/config', 'main.go', tmpDir);
    expect(result).toBe('internal/config');
  });

  it('resolveImport: returns null when path cannot be resolved', () => {
    expect(goResolver.resolveImport('fmt', 'main.go', tmpDir)).toBeNull();
  });
});
