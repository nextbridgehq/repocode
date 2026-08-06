import type { PresetConfig } from '../types.js';

export const BUILTIN_PRESETS: Record<string, PresetConfig> = {
  full: {
    description: 'Everything, no compression',
    compress: 'none',
  },
  minimal: {
    description: 'Aggressive compression, small budget',
    compress: 'tier2-structural',
    budget: { maxTokens: 40_000, reserveForResponse: 4_000, reserveForPrompt: 2_000 },
  },
  review: {
    description: 'Changed files and their neighbors',
    git: { mode: 'diff', deps: true },
    graphDepth: 1,
  },
  'ts-library': {
    description: 'TypeScript/JavaScript library — excludes generated declarations and build info',
    exclude: ['**/*.d.ts', '**/*.tsbuildinfo'],
  },
  'py-service': {
    description: 'Python service — excludes virtualenvs, bytecode caches, and egg-info',
    exclude: ['.venv/**', 'venv/**', '**/__pycache__/**', '**/*.pyc', '**/*.egg-info/**'],
  },
  'go-service': {
    description: 'Go service — excludes vendored dependencies',
    exclude: ['vendor/**'],
  },
  'rust-crate': {
    description: 'Rust crate — excludes the target build directory',
    exclude: ['target/**'],
  },
  'java-maven': {
    description: 'Java Maven project — excludes compiled classes, JARs, and build output',
    exclude: ['target/**', '**/*.class', '**/*.jar'],
  },
};
