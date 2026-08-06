import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const cliSrc = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'cli.ts',
);

describe('TUI lazy loading', () => {
  it('does not statically import the interactive command from cli.ts', () => {
    // commands/interactive.ts pulls in ink + react. A static import here makes
    // every non-interactive `repocode .` invocation load the whole TUI stack, so
    // it must stay behind a dynamic import inside the --interactive branch.
    const src = fs.readFileSync(cliSrc, 'utf-8');

    const staticImport = /^import\s[^;]*from\s+['"]\.\/commands\/interactive\.js['"]/m;
    expect(src).not.toMatch(staticImport);

    // ...and the dynamic import must still be present, so --interactive works.
    expect(src).toMatch(/await import\(['"]\.\/commands\/interactive\.js['"]\)/);
  });

  it('does not statically import ink or react anywhere outside the tui/ tree', () => {
    const srcDir = path.join(path.dirname(cliSrc));
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'tui') continue; // the TUI itself is allowed to
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (full.endsWith(path.join('commands', 'interactive.ts'))) continue; // entry point, loaded lazily
        const content = fs.readFileSync(full, 'utf-8');
        if (/^import\s[^;]*from\s+['"](ink|react)['"]/m.test(content)) {
          offenders.push(path.relative(srcDir, full));
        }
      }
    };
    walk(srcDir);

    expect(offenders).toEqual([]);
  });
});
