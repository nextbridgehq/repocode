import { describe, it, expect } from 'vitest';
import { getResolver, SOURCE_GLOB } from '../../src/languageResolvers/index.js';

describe('getResolver', () => {
  it('returns null for unknown extension', () => {
    expect(getResolver('file.unknown')).toBeNull();
  });

  it('returns null for files with no extension (e.g. Makefile)', () => {
    expect(getResolver('Makefile')).toBeNull();
  });

  it('SOURCE_GLOB is a non-empty string starting with **', () => {
    expect(typeof SOURCE_GLOB).toBe('string');
    expect(SOURCE_GLOB.startsWith('**')).toBe(true);
  });

  it('returns typescript resolver for .ts files', () => {
    expect(getResolver('src/foo.ts')?.name).toBe('typescript');
  });

  it('returns rust resolver for .rs files', () => {
    expect(getResolver('src/main.rs')?.name).toBe('rust');
  });

  it('returns ruby resolver for .rb files', () => {
    expect(getResolver('app.rb')?.name).toBe('ruby');
  });

  it('returns java resolver for .java and .kt files', () => {
    expect(getResolver('Main.java')?.name).toBe('java');
    expect(getResolver('Main.kt')?.name).toBe('java');
  });

  it('returns cpp resolver for .cpp and .h files', () => {
    expect(getResolver('main.cpp')?.name).toBe('cpp');
    expect(getResolver('utils.h')?.name).toBe('cpp');
  });

  it('returns php resolver for .php files', () => {
    expect(getResolver('App.php')?.name).toBe('php');
  });

  it('SOURCE_GLOB includes all new language extensions', () => {
    expect(SOURCE_GLOB).toContain('rs');
    expect(SOURCE_GLOB).toContain('rb');
    expect(SOURCE_GLOB).toContain('java');
    expect(SOURCE_GLOB).toContain('php');
  });
});
