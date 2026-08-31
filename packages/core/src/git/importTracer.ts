import fs from 'fs';
import path from 'path';
import { globby } from 'globby';
import type { TraceResult } from '../types.js';
import { getResolver, SOURCE_GLOB } from '../languageResolvers/index.js';
import type { LanguageResolver } from '../languageResolvers/types.js';

function isDirectory(absPath: string): boolean {
  try {
    return fs.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

/** Expand a resolved package directory into the source files it contains.
 *  Go's resolver returns a package directory rather than a file; a Go package is exactly
 *  the source files in one directory (subdirectories are separate packages), so this is
 *  deliberately non-recursive. Files with no registered resolver are skipped. */
function expandPackageDirectory(resolved: string, root: string, resolver: LanguageResolver): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, resolved), { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (getResolver(entry.name) !== resolver) continue;
    files.push(`${resolved}/${entry.name}`);
  }
  return files;
}

// Exported so graphBuilder.ts can reuse without duplicating patterns
export function extractImportsFromFile(filePath: string, content: string, root: string): string[] {
  const resolver = getResolver(filePath);
  if (!resolver) return [];
  const specs = resolver.extractImports(content, filePath);
  const results: string[] = [];
  for (const spec of specs) {
    const resolved = resolver.resolveImport(spec, filePath, root);
    if (resolved === null) continue;
    // A resolver may resolve to a package directory rather than a file. The BFS below keys
    // its map by file path, so a directory edge would be a dead end — expand it here.
    if (isDirectory(path.join(root, resolved))) {
      results.push(...expandPackageDirectory(resolved, root, resolver));
    } else {
      results.push(resolved);
    }
  }
  return [...new Set(results)];
}

export async function traceImports(
  changedPaths: string[],
  root: string,
  isExcluded: (filePath: string) => boolean,
  depth: number = 1,
  prebuiltImportMap?: Map<string, string[]>,
): Promise<TraceResult> {
  const changedSet = new Set(changedPaths);

  let importMap: Map<string, string[]>;

  if (prebuiltImportMap) {
    importMap = new Map(prebuiltImportMap);
    for (const fp of changedPaths) {
      if (!importMap.has(fp)) {
        try {
          const content = fs.readFileSync(path.join(root, fp), 'utf-8');
          importMap.set(fp, extractImportsFromFile(fp, content, root));
        } catch {
          importMap.set(fp, []);
        }
      }
    }
  } else {
    importMap = new Map<string, string[]>();
    const sourceFiles = await globby([SOURCE_GLOB], {
      cwd: root,
      onlyFiles: true,
      dot: false,
    });
    const allFiles = [...new Set([...sourceFiles, ...changedPaths])];
    for (const filePath of allFiles) {
      if (isExcluded(filePath) && !changedSet.has(filePath)) continue;
      try {
        const content = fs.readFileSync(path.join(root, filePath), 'utf-8');
        importMap.set(filePath, extractImportsFromFile(filePath, content, root));
      } catch {
        importMap.set(filePath, []);
      }
    }
  }

  // BFS from changedPaths: each round follows forward (deps) and reverse (importers) edges
  const visited = new Set<string>(changedPaths);
  const depSet = new Set<string>();
  const importerSet = new Set<string>();
  let frontier = [...changedPaths];

  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const frontierSet = new Set(frontier);
    const nextFrontier: string[] = [];

    for (const filePath of frontier) {
      for (const imp of importMap.get(filePath) ?? []) {
        if (!visited.has(imp)) {
          depSet.add(imp);
          visited.add(imp);
          nextFrontier.push(imp);
        }
      }
    }

    for (const [filePath, imports] of importMap) {
      if (visited.has(filePath)) continue;
      if (imports.some(imp => frontierSet.has(imp))) {
        importerSet.add(filePath);
        visited.add(filePath);
        nextFrontier.push(filePath);
      }
    }

    frontier = nextFrontier;
  }

  return {
    importers: [...importerSet],
    dependencies: [...depSet],
  };
}
