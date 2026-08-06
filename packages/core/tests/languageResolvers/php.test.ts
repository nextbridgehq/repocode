import { describe, it, expect } from 'vitest';
import path from 'path';
import { phpResolver } from '../../src/languageResolvers/php.js';
import { traceImports } from '../../src/git/importTracer.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures/php');

describe('phpResolver.extractImports', () => {
  it('extracts use namespace statement', () => {
    expect(phpResolver.extractImports('use App\\Models\\User;', 'src/App.php'))
      .toContain('ns:App\\Models\\User');
  });

  it('extracts string-literal require', () => {
    expect(phpResolver.extractImports("require 'config.php';", 'src/App.php'))
      .toContain('req:config.php');
  });

  it('does not extract dynamic require', () => {
    const specs = phpResolver.extractImports("require $path . '/foo.php';", 'src/App.php');
    expect(specs.some(s => s.startsWith('req:'))).toBe(false);
  });
});

describe('phpResolver.resolveImport', () => {
  it('resolves namespace via composer.json PSR-4 map', () => {
    const result = phpResolver.resolveImport('ns:App\\Models\\User', 'src/App.php', FIXTURES);
    expect(result).toBe('src/Models/User.php');
  });

  it('resolves string-literal require relative to fromFile dir', () => {
    expect(phpResolver.resolveImport('req:config.php', 'src/App.php', FIXTURES))
      .toBe('config.php');
  });

  it('returns null when namespace file does not exist', () => {
    expect(phpResolver.resolveImport('ns:App\\Missing\\Class', 'src/App.php', FIXTURES)).toBeNull();
  });
});

describe('PHP integration through traceImports', () => {
  it('resolves PSR-4 namespace and require through the registry', async () => {
    const result = await traceImports(['src/App.php'], FIXTURES, () => false);
    expect(result.dependencies).toContain('src/Models/User.php');
    expect(result.dependencies).toContain('config.php');
  });
});
