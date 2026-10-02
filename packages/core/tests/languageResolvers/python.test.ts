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

// Measured on pytest (src/_pytest/...): only 11 of 235 files resolved, because every one of
// these forms returned null. Centrality and import tracing were both built on the leftovers.
describe('pythonResolver — real-world layouts', () => {
  let root: string;
  const put = (rel: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), '');
  };
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-py-layout-'));
    put('src/_pytest/__init__.py');
    put('src/_pytest/nodes.py');
    put('src/_pytest/config/__init__.py');
    put('django/db/__init__.py');
    put('django/db/models/__init__.py');
    put('django/db/models/query.py');
    put('pkg/a.py');
    put('pkg/b.py');
  });
  afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

  const resolveAll = (src: string, from: string) =>
    pythonResolver.extractImports(src, from)
      .map(s => pythonResolver.resolveImport(s, from, root))
      .filter((p): p is string => p !== null);

  it('resolves absolute imports of a package kept under src/', () => {
    expect(resolveAll('from _pytest.nodes import Item', 'src/_pytest/main.py')).toContain('src/_pytest/nodes.py');
  });

  it('resolves a package import to its __init__.py', () => {
    expect(resolveAll('import _pytest.config', 'src/_pytest/main.py')).toContain('src/_pytest/config/__init__.py');
  });

  it('resolves `from package import submodule` to the submodule file', () => {
    expect(resolveAll('from django.db.models import query', 'django/x.py')).toContain('django/db/models/query.py');
  });

  it('resolves names inside a parenthesised, multi-line from-import', () => {
    const src = 'from pkg import (\n    a,\n    b as bee,\n)\n';
    expect(resolveAll(src, 'main.py')).toEqual(expect.arrayContaining(['pkg/a.py', 'pkg/b.py']));
  });

  it('resolves `from . import sibling`', () => {
    expect(resolveAll('from . import b', 'pkg/a.py')).toContain('pkg/b.py');
  });

  it('resolves every module in a comma-separated import', () => {
    expect(resolveAll('import pkg.a, pkg.b as bee', 'main.py')).toEqual(expect.arrayContaining(['pkg/a.py', 'pkg/b.py']));
  });
});
