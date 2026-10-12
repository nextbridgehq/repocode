import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Retrieval } from '../scoring.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

export interface RepocodeResult {
  files: Retrieval[];
  /** Compression level per selected file, keyed by path — diagnosis only, not used in scoring. */
  levels: Record<string, string>;
  diagnostics?: {
    totalDiscovered: number;
    totalIncluded: number;
    totalExcluded: number;
    excludedReasons: Record<string, number>;
  };
}

export async function runRepocode(
  repoDir: string,
  budget: string,
  query?: string,
  queryFile?: string,
): Promise<RepocodeResult> {
  const cliPath = process.env.REPOCODE_CLI ?? path.resolve(__dirname, '../../../cli/dist/cli.js');
  
  const args = [
    cliPath,
    repoDir,
    '--budget', budget,
    '--format', 'json',
    '--stdout',
    '--verbose',
  ];

  if (query) {
    args.push('--query', query);
  }
  if (queryFile) {
    args.push('--query-file', queryFile);
  }

  try {
    const { stdout, stderr } = await execFileAsync('node', args, { maxBuffer: 1024 * 1024 * 50 });
    
    const result = JSON.parse(stdout);
    const raw: any[] = result.files && Array.isArray(result.files) ? result.files : [];
    // `content` is what repocode actually delivers for this file — after whichever compression
    // tier the fitter settled on. Scoring uses that, not the path, so a stripped signature is
    // no longer indistinguishable from the whole file.
    const files: Retrieval[] = raw.map(f => ({
      path: f.path,
      chars: typeof f.content === 'string' ? f.content.trim().length : 0,
      content: typeof f.content === 'string' ? f.content : undefined,
    }));
    const levels: Record<string, string> = {};
    for (const f of raw) levels[f.path] = f.compressionLevel ?? 'unknown';

    // Parse diagnostics from stderr (verbose output)
    const diagnostics = {
      totalDiscovered: 0,
      totalIncluded: files.length,
      totalExcluded: 0,
      excludedReasons: {} as Record<string, number>,
    };

    // Extract exclusion reasons from verbose output
    const excludedMatch = stderr.match(/Excluded:\s*(\d+)/);
    if (excludedMatch) {
      diagnostics.totalExcluded = parseInt(excludedMatch[1], 10);
    }

    // Count reasons
    const reasonRegex = /\[([^\]]+)\]/g;
    let reasonMatch;
    while ((reasonMatch = reasonRegex.exec(stderr)) !== null) {
      const reason = reasonMatch[1];
      diagnostics.excludedReasons[reason] = (diagnostics.excludedReasons[reason] || 0) + 1;
    }

    return { files, levels, diagnostics };
  } catch (error: any) {
    console.error(`repocode arm failed in ${repoDir}:`, error.stderr || error.message);
    return { files: [], levels: {} };
  }
}
