import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { rm } from 'fs/promises';

describe('resolveRemote — real network integration', () => {
  it('fetches and extracts a real small public repo', async () => {
    const { resolveRemote } = await import('../../src/remote/resolveRemote.js');
    // octocat/Hello-World is GitHub's own long-standing demo repo — tiny,
    // stable, extremely unlikely to be deleted or renamed.
    const dir = await resolveRemote({ owner: 'octocat', repo: 'Hello-World' });
    try {
      expect(existsSync(dir)).toBe(true);
      expect(existsSync(join(dir, 'README'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
