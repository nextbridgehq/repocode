import { describe, it, expect } from 'vitest';
import path from 'path';
import { rubyResolver } from '../../src/languageResolvers/ruby.js';
import { traceImports } from '../../src/git/importTracer.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures/ruby');

describe('rubyResolver.extractImports', () => {
  it('extracts require_relative specifier', () => {
    expect(rubyResolver.extractImports("require_relative 'models/user'", 'app.rb'))
      .toContain('relative:models/user');
  });

  it('extracts bare require as external', () => {
    expect(rubyResolver.extractImports("require 'json'", 'app.rb')).toContain('gem:json');
  });

  it('extracts load statement', () => {
    expect(rubyResolver.extractImports("load 'config.rb'", 'app.rb')).toContain('load:config.rb');
  });
});

describe('rubyResolver.resolveImport', () => {
  it('resolves require_relative to sibling .rb file', () => {
    expect(rubyResolver.resolveImport('relative:models/user', 'app.rb', FIXTURES))
      .toBe('models/user.rb');
  });

  it('resolves load to sibling .rb file', () => {
    expect(rubyResolver.resolveImport('load:config.rb', 'app.rb', FIXTURES))
      .toBe('config.rb');
  });

  it('returns null for gem requires', () => {
    expect(rubyResolver.resolveImport('gem:json', 'app.rb', FIXTURES)).toBeNull();
  });
});

describe('Ruby integration through traceImports', () => {
  it('resolves require_relative imports via the registry', async () => {
    const result = await traceImports(['app.rb'], FIXTURES, () => false);
    expect(result.dependencies).toContain('models/user.rb');
    expect(result.dependencies).not.toContain('json'); // gem, should not appear
  });
});
