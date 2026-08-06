import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { tsResolver } from '../../src/languageResolvers/typescript.js';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-ts-resolver-'));
  fs.writeFileSync(path.join(tmpDir, 'a.ts'), `import { b } from './b.js';\nexport const a = 1;`);
  fs.writeFileSync(path.join(tmpDir, 'b.ts'), `export const b = 2;`);
});

afterAll(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe('tsResolver.extractImports', () => {
  it('extracts relative specifiers from import statements', () => {
    const specs = tsResolver.extractImports(`import { b } from './b.js';\nimport x from 'react';`, 'a.ts');
    expect(specs).toContain('./b.js');
    expect(specs).toContain('react');
  });

  it('extracts re-export specifiers', () => {
    const specs = tsResolver.extractImports(`export { b } from './b.js';`, 'a.ts');
    expect(specs).toContain('./b.js');
  });

  it('extracts dynamic import specifiers', () => {
    const specs = tsResolver.extractImports(`const m = await import('./utils.js');`, 'a.ts');
    expect(specs).toContain('./utils.js');
  });
});

describe('tsResolver.resolveImport', () => {
  it('resolves .js specifier to existing .ts file', () => {
    const result = tsResolver.resolveImport('./b.js', 'a.ts', tmpDir);
    expect(result).toBe('b.ts');
  });

  it('returns null for external packages', () => {
    expect(tsResolver.resolveImport('react', 'a.ts', tmpDir)).toBeNull();
    expect(tsResolver.resolveImport('@scope/pkg', 'a.ts', tmpDir)).toBeNull();
  });

  it('returns null for relative path that does not exist on disk', () => {
    expect(tsResolver.resolveImport('./nonexistent.js', 'a.ts', tmpDir)).toBeNull();
  });
});
