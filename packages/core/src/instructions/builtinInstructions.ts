import type { InstructionDef } from '../types.js';

export const BUILTIN_INSTRUCTIONS: Record<string, InstructionDef> = {
  review: {
    description: 'Request a thorough code review',
    text: 'Please review this codebase ({{repo_name}}, {{files_count}} files on branch {{git_branch}}). Look for bugs, security issues, and opportunities to improve readability and maintainability. Be specific and actionable.',
  },
  explain: {
    description: 'Ask for an explanation of the codebase',
    text: 'Please explain the architecture and key design decisions in this codebase ({{repo_name}}, {{files_count}} files). Start with a high-level overview, then cover the most important components.',
  },
  bugfix: {
    description: 'Debug mode — find and fix a specific issue',
    text: 'I need help debugging an issue in this codebase ({{repo_name}}). Review the relevant code and help me identify the root cause and the best fix.',
  },
  refactor: {
    description: 'Request refactoring suggestions',
    text: 'Please suggest refactoring opportunities for this codebase ({{repo_name}}, {{files_count}} files). Focus on reducing complexity, improving testability, and eliminating duplication.',
  },
  'security-audit': {
    description: 'Security-focused review',
    text: 'Perform a security audit of this codebase ({{repo_name}}, {{files_count}} files on {{git_branch}}). Look for authentication flaws, input validation issues, secrets in code, and OWASP Top 10 vulnerabilities.',
  },
  document: {
    description: 'Generate or improve documentation',
    text: 'Please help document this codebase ({{repo_name}}, {{files_count}} files). Generate clear JSDoc/docstring comments for the key exported functions and types, and suggest a README structure.',
  },
  test: {
    description: 'Generate tests for the codebase',
    text: 'Generate comprehensive tests for this codebase ({{repo_name}}, {{files_count}} files). Focus on the most critical paths and edge cases. Use the existing test framework and patterns you see in the code.',
  },
};
