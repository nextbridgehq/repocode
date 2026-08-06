import fs from 'fs';
import path from 'path';
import { globby } from 'globby';
import type { IgnoreConfig } from '../types.js';
import { extractImportsFromFile } from '../git/importTracer.js';
import { buildIgnoreFilter } from '../discovery/ignoreRules.js';
import { FileCache } from '../cache/fileCache.js';
import { SOURCE_GLOB } from '../languageResolvers/index.js';

export interface BuildGraphResult {
  centralityMap: Map<string, number>;
  imports: Record<string, string[]>;  // root-relative path → root-relative direct imports
}

async function buildAdjacencyList(
  root: string,
  sourceFiles: string[],
  shouldInclude: (f: string) => boolean,
  cache: FileCache,
): Promise<Record<string, string[]>> {
  const fileSet = new Set(sourceFiles);
  const imports: Record<string, string[]> = {};

  for (const relPath of sourceFiles) {
    if (!shouldInclude(relPath)) continue;
    try {
      const content = fs.readFileSync(path.join(root, relPath), 'utf-8');
      const cached = cache.get(relPath, content);
      if (cached?.imports !== undefined) {
        imports[relPath] = cached.imports.filter(dep => fileSet.has(dep));
        continue;
      }
      const resolved = extractImportsFromFile(relPath, content, root);
      const filtered = resolved.filter(dep => fileSet.has(dep));
      cache.set(relPath, content, { imports: filtered });
      imports[relPath] = filtered;
    } catch {
      imports[relPath] = [];
    }
  }

  return imports;
}

function computeCentrality(root: string, imports: Record<string, string[]>): Map<string, number> {
  const inDegree = new Map<string, number>();

  for (const [, deps] of Object.entries(imports)) {
    for (const dep of deps) {
      inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
    }
  }

  for (const relPath of Object.keys(imports)) {
    if (!inDegree.has(relPath)) inDegree.set(relPath, 0);
  }

  const maxInDegree = Math.max(1, ...inDegree.values());

  const centralityMap = new Map<string, number>();
  for (const [relPath, deg] of inDegree) {
    centralityMap.set(path.join(root, relPath), deg / maxInDegree);
  }
  return centralityMap;
}

export async function buildGraph(
  root: string,
  ignore: IgnoreConfig,
  cache?: FileCache,
): Promise<BuildGraphResult> {
  const fileCache = cache ?? FileCache.load(root);

  const sourceFiles = await globby([SOURCE_GLOB], {
    cwd: root,
    onlyFiles: true,
    dot: false,
  });

  const shouldInclude = await buildIgnoreFilter(root, ignore);
  const imports = await buildAdjacencyList(root, sourceFiles, shouldInclude, fileCache);

  if (!cache) {
    fileCache.save();
  }

  return { centralityMap: computeCentrality(root, imports), imports };
}
