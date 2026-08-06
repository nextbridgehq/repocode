import { describe, it, expect } from 'vitest';
import path from 'path';
import { javaResolver } from '../../src/languageResolvers/java.js';
import { traceImports } from '../../src/git/importTracer.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures/java');
const MAIN = 'src/main/java/com/example/Main.java';

describe('javaResolver.extractImports', () => {
  it('extracts import statements', () => {
    const specs = javaResolver.extractImports('import com.example.util.StringUtils;\nimport java.util.List;', MAIN);
    expect(specs).toContain('com.example.util.StringUtils');
    expect(specs).toContain('java.util.List');
  });
});

describe('javaResolver.resolveImport', () => {
  it('resolves internal class to file path under Maven source root', () => {
    const result = javaResolver.resolveImport('com.example.util.StringUtils', MAIN, FIXTURES);
    expect(result).toBe('src/main/java/com/example/util/StringUtils.java');
  });

  it('returns null for java.* stdlib imports', () => {
    expect(javaResolver.resolveImport('java.util.List', MAIN, FIXTURES)).toBeNull();
  });

  it('returns null for javax.* imports', () => {
    expect(javaResolver.resolveImport('javax.servlet.HttpServlet', MAIN, FIXTURES)).toBeNull();
  });

  it('returns null when file does not exist', () => {
    expect(javaResolver.resolveImport('com.example.Missing', MAIN, FIXTURES)).toBeNull();
  });
});

describe('Java integration through traceImports', () => {
  it('resolves Maven-structured internal import through the registry', async () => {
    const result = await traceImports([MAIN], FIXTURES, () => false);
    expect(result.dependencies).toContain('src/main/java/com/example/util/StringUtils.java');
    expect(result.dependencies.some(d => d.includes('java.util'))).toBe(false);
  });
});
