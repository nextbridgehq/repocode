import { describe, it, expect } from 'vitest';
import { translateRepomixConfig } from '../../src/config/fromRepomix.js';

describe('translateRepomixConfig', () => {
  it('maps output style to the equivalent format', () => {
    expect(translateRepomixConfig({ output: { style: 'markdown' } }).config.output?.format).toBe('markdown');
    expect(translateRepomixConfig({ output: { style: 'xml' } }).config.output?.format).toBe('xml');
    expect(translateRepomixConfig({ output: { style: 'plain' } }).config.output?.format).toBe('plain');
  });

  it('carries across output path, header and line numbers', () => {
    const { config } = translateRepomixConfig({
      output: { filePath: 'ctx.xml', headerText: 'read this', showLineNumbers: true },
    });
    expect(config.output).toMatchObject({ filePath: 'ctx.xml', headerText: 'read this', showLineNumbers: true });
  });

  it('maps compress:true to tier2, the closest equivalent', () => {
    // Repomix --compress extracts signatures via Tree-sitter. tier2-structural strips function
    // bodies and keeps signatures, so it is the nearest thing we have — not identical output,
    // but the same intent.
    const { config, notes } = translateRepomixConfig({ output: { compress: true } });
    expect(config.compress).toBe('tier2-structural');
    expect(notes.join(' ')).toMatch(/tier2-structural/);
  });

  it('carries ignore settings across', () => {
    const { config } = translateRepomixConfig({
      ignore: { useGitignore: false, useDefaultPatterns: true, customPatterns: ['dist/**', '*.snap'] },
    });
    expect(config.ignore).toEqual({
      useGitignore: false, useDefaultPatterns: true, customPatterns: ['dist/**', '*.snap'],
    });
  });

  it('maps include patterns', () => {
    expect(translateRepomixConfig({ include: ['src/**/*.ts'] }).config.include).toEqual(['src/**/*.ts']);
  });

  it('maps the security check flag', () => {
    expect(translateRepomixConfig({ security: { enableSecurityCheck: false } }).config.security?.enabled).toBe(false);
    expect(translateRepomixConfig({ security: { enableSecurityCheck: true } }).config.security?.enabled).toBe(true);
  });

  it('reports settings it could not translate rather than dropping them silently', () => {
    // A migration that quietly discards half a config is worse than one that says what it left.
    const { notes } = translateRepomixConfig({
      output: { removeComments: true, topFilesLength: 20, instructionFilePath: 'x.md' },
      tokenCount: { encoding: 'o200k_base' },
    } as never);
    const joined = notes.join('\n');
    expect(joined).toMatch(/removeComments/);
    expect(joined).toMatch(/topFilesLength/);
  });

  it('returns an empty config for an empty input rather than inventing defaults', () => {
    const { config } = translateRepomixConfig({});
    expect(Object.keys(config)).toHaveLength(0);
  });

  it('ignores an unknown output style instead of producing an invalid format', () => {
    const { config, notes } = translateRepomixConfig({ output: { style: 'yaml' } } as never);
    expect(config.output?.format).toBeUndefined();
    expect(notes.join(' ')).toMatch(/yaml/);
  });
});
