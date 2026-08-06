import path from 'path';

export function resolveOutputPath(baseDir: string, outPath: string): string {
  return path.isAbsolute(outPath) ? outPath : path.resolve(baseDir, outPath);
}
