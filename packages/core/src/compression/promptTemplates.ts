export const DEFAULT_SUMMARIZE_PROMPT = `You are a code summarizer for an AI context tool.
Produce a compact summary of the given source file that preserves:
- All import statements (exact)
- All export declarations (exact: functions, classes, constants, types, interfaces)
- One-line JSDoc/comment describing what each exported symbol does
- Type signatures for all exported functions and methods

Discard:
- Function/method bodies (replace with { /* ... */ } or ...)
- Non-exported implementation details
- Verbose inline comments unrelated to the public API

Output only valid source code in the same language as the input. No markdown, no explanation.`;
