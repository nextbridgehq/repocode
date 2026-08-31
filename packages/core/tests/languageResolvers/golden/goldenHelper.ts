import path from 'path';
import { traceImports } from '../../../src/git/importTracer.js';

const GOLDEN_FIXTURES_ROOT = path.join(import.meta.dirname, '..', 'fixtures', 'golden');
const HARDCASE_FIXTURES_ROOT = path.join(import.meta.dirname, '..', 'fixtures', 'hardcases');

export interface GoldenTrace {
  dependencies: string[];
  importers: string[];
}

async function traceAt(root: string, entry: string, depth: number): Promise<GoldenTrace> {
  const result = await traceImports([entry], root, () => false, depth);
  return {
    dependencies: [...result.dependencies].sort(),
    importers: [...result.importers].sort(),
  };
}

/**
 * Run the real import tracer against one golden fixture and return its result with both
 * arrays sorted, so assertions compare sets rather than the tracer's insertion order.
 */
export async function traceFixture(
  language: string,
  entry: string,
  depth: number,
): Promise<GoldenTrace> {
  return traceAt(path.join(GOLDEN_FIXTURES_ROOT, language), entry, depth);
}

/**
 * Same, for a hard-case fixture — a scenario shaped around one specific resolution edge
 * case rather than the golden fixtures' uniform entry/mid/leaf/importer/importer2 chain.
 */
export async function traceHardCase(
  caseName: string,
  entry: string,
  depth: number,
): Promise<GoldenTrace> {
  return traceAt(path.join(HARDCASE_FIXTURES_ROOT, caseName), entry, depth);
}
