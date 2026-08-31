import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');
const GOLDEN_DIR = path.join(FIXTURES_DIR, 'golden');
const HARDCASES_DIR = path.join(FIXTURES_DIR, 'hardcases');

/** Fixture dirs backing the per-resolver unit tests. */
const UNIT_LANGS = ['rust', 'ruby', 'java', 'cpp', 'php', 'csharp'];

/** Fixture dirs backing the whole-graph golden tests — every language with a resolver. */
const GOLDEN_LANGS = ['typescript', 'python', 'go', 'rust', 'ruby', 'java', 'cpp', 'php', 'csharp'];

function collectFiles(dir: string): string[] {
  const files: string[] = [];
  function walk(d: string): void {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(d, entry.name));
      else files.push(path.join(d, entry.name));
    }
  }
  walk(dir);
  return files;
}

describe('language resolver fixtures', () => {
  it('all unit-test fixture directories exist and contain at least 3 files', () => {
    for (const lang of UNIT_LANGS) {
      const dir = path.join(FIXTURES_DIR, lang);
      expect(fs.existsSync(dir), `Missing fixtures dir for ${lang}`).toBe(true);
      expect(collectFiles(dir).length, `${lang} fixtures has < 3 files`).toBeGreaterThanOrEqual(3);
    }
  });

  it('every golden fixture carries exactly the 5-file entry/mid/leaf/importer/importer2 chain', () => {
    for (const lang of GOLDEN_LANGS) {
      const dir = path.join(GOLDEN_DIR, lang);
      expect(fs.existsSync(dir), `Missing golden fixture dir for ${lang}`).toBe(true);
      // composer.json is PHP resolver config, not a source file in the chain.
      const sourceFiles = collectFiles(dir).filter(f => path.basename(f) !== 'composer.json');
      expect(sourceFiles.length, `${lang} golden fixture must have exactly 5 source files`).toBe(5);
    }
  });

  it('no stray directories exist under fixtures/golden beyond the 8 expected languages', () => {
    const actual = fs.readdirSync(GOLDEN_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();
    expect(actual).toEqual([...GOLDEN_LANGS].sort());
  });

  it('every golden language has a corresponding golden test file', () => {
    const goldenTestsDir = path.join(import.meta.dirname, 'golden');
    for (const lang of GOLDEN_LANGS) {
      const testFile = path.join(goldenTestsDir, `${lang}.golden.test.ts`);
      expect(fs.existsSync(testFile), `Missing golden test file for ${lang}`).toBe(true);
    }
  });

  it('every hard-case fixture has a corresponding hard-case test file', () => {
    const hardcaseTestsDir = path.join(import.meta.dirname, 'hardcases');
    const dirs = fs.readdirSync(HARDCASES_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
    expect(dirs.length, 'expected at least one hard-case fixture').toBeGreaterThan(0);
    for (const name of dirs) {
      const testFile = path.join(hardcaseTestsDir, `${name}.hardcase.test.ts`);
      expect(fs.existsSync(testFile), `Missing hard-case test file for ${name}`).toBe(true);
    }
  });
});
