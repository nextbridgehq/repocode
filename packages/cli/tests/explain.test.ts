import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { packCommand } from '../src/commands/pack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../../core/tests/fixtures/simple-ts');

describe('--explain mode', () => {
  it('writes a ranked file table to stderr and does not write output file', async () => {
    const stderrLines: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((msg) => {
      stderrLines.push(String(msg));
      return true;
    });

    await packCommand(FIXTURE, { explain: true });

    spy.mockRestore();

    const combined = stderrLines.join('');
    expect(combined).toContain('Score');
    expect(combined).toContain('Rank');
    expect(combined).toContain('.ts');
  });
});
