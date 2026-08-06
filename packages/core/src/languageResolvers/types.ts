export interface LanguageResolver {
  /** Human-readable name for debug output */
  name: string;
  /** File extensions this resolver handles, lowercase with dot (e.g. '.ts', '.js') */
  extensions: string[];
  /** Extract all import specifiers from file content. Returns raw specifiers including
   *  external/stdlib ones — the orchestrator filters nulls from resolveImport. */
  extractImports(content: string, filePath: string): string[];
  /** Map a raw specifier to a root-relative file path, or null for external/stdlib imports.
   *  Resolvers may call fs.existsSync() — not required to be pure. */
  resolveImport(importSpec: string, fromFile: string, rootDir: string): string | null;
}
