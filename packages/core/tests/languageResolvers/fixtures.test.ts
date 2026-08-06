import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');
const EXPECTED_LANGS = ['rust', 'ruby', 'java', 'cpp', 'php'];

describe('language resolver fixtures', () => {
  it('all fixture directories exist and contain at least 3 files', () => {
    for (const lang of EXPECTED_LANGS) {
      const dir = path.join(FIXTURES_DIR, lang);
      expect(fs.existsSync(dir), `Missing fixtures dir for ${lang}`).toBe(true);
      const files: string[] = [];
      function collect(d: string): void {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          if (entry.isDirectory()) collect(path.join(d, entry.name));
          else files.push(path.join(d, entry.name));
        }
      }
      collect(dir);
      expect(files.length, `${lang} fixtures has < 3 files`).toBeGreaterThanOrEqual(3);
    }
  });
});
