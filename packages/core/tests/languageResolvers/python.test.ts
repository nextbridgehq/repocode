import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pythonResolver } from '../../src/languageResolvers/python.js';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-py-'));
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'utils.py'), 'def helper(): pass');
});

afterAll(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe('pythonResolver', () => {
  it('extractImports: captures from-import specifier', () => {
    expect(pythonResolver.extractImports('from src.utils import helper', 'main.py')).toContain('src.utils');
  });

  it('extractImports: captures bare import specifier', () => {
    expect(pythonResolver.extractImports('import os\nimport src.utils', 'main.py')).toContain('src.utils');
  });

  it('resolveImport: maps dotted path to file if it exists', () => {
    expect(pythonResolver.resolveImport('src.utils', 'main.py', tmpDir)).toBe('src/utils.py');
  });

  it('resolveImport: returns null for stdlib / missing modules', () => {
    expect(pythonResolver.resolveImport('os', 'main.py', tmpDir)).toBeNull();
  });
});
