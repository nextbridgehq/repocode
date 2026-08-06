import { describe, it, expect } from 'vitest';
import { generateTree } from '../../src/output/treeGenerator.js';

describe('generateTree', () => {
  it('renders a simple tree', () => {
    const tree = generateTree(['src/index.ts', 'src/auth/login.ts', 'src/api/routes.ts']);
    expect(tree).toContain('src/');
    expect(tree).toContain('index.ts');
    expect(tree).toContain('auth/');
    expect(tree).toContain('login.ts');
  });

  it('uses └── for last item and ├── for others', () => {
    const tree = generateTree(['src/a.ts', 'src/b.ts']);
    expect(tree).toContain('├──');
    expect(tree).toContain('└──');
  });

  it('handles a single file', () => {
    const tree = generateTree(['src/index.ts']);
    expect(tree).toContain('index.ts');
  });

  it('returns empty string for no files', () => {
    expect(generateTree([])).toBe('');
  });
});
