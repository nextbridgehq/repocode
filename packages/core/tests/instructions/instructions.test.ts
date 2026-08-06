import { describe, it, expect } from 'vitest';
import { resolveInstruction } from '../../src/instructions/index.js';

describe('resolveInstruction', () => {
  it('resolves built-in instruction by name', () => {
    const text = resolveInstruction(
      { name: 'review' }, {}, { filesCount: 5, gitBranch: 'main', repoName: 'myrepo', date: '2026-07-02' }, '.'
    );
    expect(text).toBeTruthy();
    expect(text).toContain('review');
  });

  it('resolves user-defined instruction by name', () => {
    const text = resolveInstruction(
      { name: 'custom-task' },
      { 'custom-task': { text: 'Do something custom for {{repo_name}}' } },
      { filesCount: 3, gitBranch: 'dev', repoName: 'proj', date: '2026-07-02' },
      '.'
    );
    expect(text).toBe('Do something custom for proj');
  });

  it('uses inline text directly', () => {
    const text = resolveInstruction({ text: 'Inline instruction' }, {}, { filesCount: 0, gitBranch: '', repoName: '', date: '' }, '.');
    expect(text).toBe('Inline instruction');
  });

  it('returns null when no instruction configured', () => {
    const text = resolveInstruction(undefined, {}, { filesCount: 0, gitBranch: '', repoName: '', date: '' }, '.');
    expect(text).toBeNull();
  });

  it('renders template variables', () => {
    const text = resolveInstruction(
      { text: 'Files: {{files_count}}, Branch: {{git_branch}}' },
      {},
      { filesCount: 12, gitBranch: 'feature/x', repoName: 'r', date: '2026-07-02' },
      '.'
    );
    expect(text).toBe('Files: 12, Branch: feature/x');
  });
});
