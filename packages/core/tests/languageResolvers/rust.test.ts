import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { rustResolver } from '../../src/languageResolvers/rust.js';
import { traceImports } from '../../src/git/importTracer.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures/rust');

describe('rustResolver.extractImports', () => {
  it('extracts mod declaration', () => {
    expect(rustResolver.extractImports('mod config;', 'src/main.rs')).toContain('mod:config');
  });

  it('extracts crate:: use statement', () => {
    const specs = rustResolver.extractImports('use crate::config::Settings;', 'src/main.rs');
    expect(specs).toContain('crate::config::Settings');
  });

  it('extracts self:: use statement', () => {
    const specs = rustResolver.extractImports('use self::utils;', 'src/main.rs');
    expect(specs).toContain('self::utils');
  });

  it('extractImports: captures extern crate', () => {
    const specs = rustResolver.extractImports('extern crate serde;', 'src/main.rs');
    expect(specs).toContain('extern:serde');
  });
});

describe('rustResolver.resolveImport', () => {
  it('resolves mod declaration to sibling .rs file', () => {
    const result = rustResolver.resolveImport('mod:config', 'src/main.rs', FIXTURES);
    expect(result).toBe('src/config.rs');
  });

  it('resolves mod declaration to directory mod.rs', () => {
    const result = rustResolver.resolveImport('mod:utils', 'src/main.rs', FIXTURES);
    expect(result).toBe('src/utils/mod.rs');
  });

  it('resolves crate:: path to file', () => {
    const result = rustResolver.resolveImport('crate::config::Settings', 'src/main.rs', FIXTURES);
    expect(result).toBe('src/config.rs');
  });

  it('returns null for extern crate (external)', () => {
    expect(rustResolver.resolveImport('extern:serde', 'src/main.rs', FIXTURES)).toBeNull();
  });

  it('returns null for std:: (stdlib)', () => {
    expect(rustResolver.resolveImport('std::io::Read', 'src/main.rs', FIXTURES)).toBeNull();
  });
});

describe('Rust integration through traceImports', () => {
  it('traces mod and crate:: imports through the registry', async () => {
    const result = await traceImports(['src/main.rs'], FIXTURES, () => false);
    expect(result.dependencies).toContain('src/config.rs');
    // stdlib should never appear
    expect(result.dependencies.some(d => d.includes('std'))).toBe(false);
  });
});
