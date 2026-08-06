import { describe, it, expect } from 'vitest';
import path from 'path';
import { cppResolver } from '../../src/languageResolvers/cpp.js';
import { traceImports } from '../../src/git/importTracer.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures/cpp');

describe('cppResolver.extractImports', () => {
  it('extracts quoted includes as local', () => {
    expect(cppResolver.extractImports('#include "utils.h"', 'main.cpp')).toContain('local:utils.h');
  });

  it('extracts angle-bracket includes as system', () => {
    expect(cppResolver.extractImports('#include <stdio.h>', 'main.cpp')).toContain('system:stdio.h');
  });

  it('extracts multi-level quoted include', () => {
    expect(cppResolver.extractImports('#include "subdir/helper.h"', 'main.cpp'))
      .toContain('local:subdir/helper.h');
  });
});

describe('cppResolver.resolveImport', () => {
  it('resolves local include to file in fromFile directory', () => {
    expect(cppResolver.resolveImport('local:utils.h', 'main.cpp', FIXTURES)).toBe('utils.h');
  });

  it('returns null for system includes', () => {
    expect(cppResolver.resolveImport('system:stdio.h', 'main.cpp', FIXTURES)).toBeNull();
    expect(cppResolver.resolveImport('system:vector', 'main.cpp', FIXTURES)).toBeNull();
  });

  it('returns null when local file does not exist', () => {
    expect(cppResolver.resolveImport('local:nonexistent.h', 'main.cpp', FIXTURES)).toBeNull();
  });
});

describe('C/C++ integration through traceImports', () => {
  it('resolves local #include imports through the registry', async () => {
    const result = await traceImports(['main.cpp'], FIXTURES, () => false);
    expect(result.dependencies).toContain('utils.h');
    // system headers must not appear
    expect(result.dependencies.some(d => d === 'stdio.h')).toBe(false);
  });
});
