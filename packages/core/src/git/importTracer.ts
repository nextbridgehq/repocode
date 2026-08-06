import fs from 'fs';
import path from 'path';
import { globby } from 'globby';
import type { TraceResult } from '../types.js';
import { getResolver, SOURCE_GLOB } from '../languageResolvers/index.js';

// Exported so graphBuilder.ts can reuse without duplicating patterns
export function extractImportsFromFile(filePath: string, content: string, root: string): string[] {
  const resolver = getResolver(filePath);
  if (!resolver) return [];
  const specs = resolver.extractImports(content, filePath);
  const results = specs
    .map(spec => resolver.resolveImport(spec, filePath, root))
    .filter((p): p is string => p !== null);
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
