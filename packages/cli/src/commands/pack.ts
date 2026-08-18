import { runPipeline } from '@repocode/core';
import type { OutputFormat, CacheStats } from '@repocode/core';
import path from 'path';
import fs from 'fs';
import kleur from 'kleur';
import ora from 'ora';
import { buildPackConfig, type CLIOptions } from './buildConfig.js';
import { resolveOutputPath } from '../output/resolveOutputPath.js';
import { buildExplainReport } from '../output/explainReport.js';

const FORMAT_EXTENSIONS: Record<OutputFormat, string> = {
  xml: '.xml', markdown: '.md', plain: '.txt', json: '.json',
};

/** One-line cache summary, e.g. "file 42/50 hits (84%) · llm 3/4 hits (75%)".
 *  Returns '' when no cache did any work, so the line is omitted entirely. */
function formatCacheStats(stats: CacheStats): string {
  const parts: string[] = [];
  for (const [label, stat] of Object.entries(stats)) {
    if (!stat) continue;
    const lookups = stat.hits + stat.misses;
    if (lookups === 0) continue;
    const pct = Math.round((stat.hits / lookups) * 100);
    parts.push(`${label} ${stat.hits}/${lookups} hits (${pct}%)`);
  }
  return parts.join(' · ');
}

export async function packCommand(
  targetPath: string,
  opts: CLIOptions,
  optionSource?: (key: string) => string | undefined,
): Promise<void> {
  const config = await buildPackConfig(targetPath, opts, optionSource);
  const root = config.root;

  const spinner = ora({ stream: process.stderr }).start('Discovering files...');

  try {
    const result = await runPipeline(config);

    spinner.stop();

    if (opts.explain && config.output.format === 'json') {
      // Machine-readable form, on stdout so it can be piped, captured in CI, or diffed between
      // commits to surface a ranking change without re-running a benchmark.
      process.stdout.write(JSON.stringify(buildExplainReport(result, config), null, 2) + '\n');
      return;
    }

    if (opts.explain) {
      const header = 'Rank  Score  Struct  Depth   Size    Kw    Recency  Path';
      process.stderr.write(header + '\n');
      process.stderr.write('-'.repeat(header.length) + '\n');
      for (const f of result.included) {
        const s = f.signalScores;
        const row = [
          `#${f.rankPosition ?? '?'}`.padStart(5),
          f.score.toFixed(2).padStart(6),
          (s.structural).toFixed(2).padStart(7),
          (s.depth).toFixed(2).padStart(6),
          (s.size).toFixed(2).padStart(7),
          (s.keyword).toFixed(2).padStart(5),
          (s.recency).toFixed(2).padStart(8),
          '  ' + f.path,
        ].join('');
        process.stderr.write(row + '\n');
      }
      if (result.excluded.length > 0) {
        process.stderr.write('\nExcluded:\n');
        for (const ex of result.excluded) {
          process.stderr.write(`  ${ex.path}  [${ex.reason}]\n`);
        }
      }
      return;
    }

    if (config.dryRun) {
      process.stderr.write(kleur.cyan('\n  Dry run — no output written\n'));
      process.stderr.write(`  Would include: ${result.included.length} files\n`);
      return;
    }

    const format = config.output.format;
    const defaultFilename = `repocode-output${FORMAT_EXTENSIONS[format]}`;
    const outPath = config.output.filePath ?? defaultFilename;
    const resolvedOutPath = resolveOutputPath(opts.outputBaseDir ?? root, outPath);

    if (!config.output.stdout) {
      fs.writeFileSync(resolvedOutPath, result.output, 'utf-8');
    }

    if (config.output.stdout) {
      process.stdout.write(result.output);
    }

    if (config.output.copy) {
      const { default: clipboard } = await import('clipboardy');
      await clipboard.write(result.output);
    }

    // Print summary to stderr
    const budgetLine = result.budget
      ? `${result.totalTokens.toLocaleString()} / ${result.budget.maxTokens.toLocaleString()} (${Math.round((result.totalTokens / result.budget.maxTokens) * 100)}%)`
      : `${result.totalTokens.toLocaleString()} (no budget)`;

    const compressed = result.included.filter(f => f.compressed).length;
    const pinned = config.ranking.pinned.length;

    process.stderr.write('\n');
    process.stderr.write(`  Files:      ${kleur.green(String(result.included.length))} included, ${result.excluded.length} excluded\n`);
    process.stderr.write(`  Tokens:     ${kleur.yellow(budgetLine)}\n`);
    if (pinned > 0) process.stderr.write(`  Pinned:     ${pinned} files (always included)\n`);
    if (compressed > 0) process.stderr.write(`  Compressed: ${compressed} files (lossless)\n`);
    process.stderr.write(`  Format:     ${format.toUpperCase()}${config.output.stdout ? ' → stdout' : ` → ${resolvedOutPath}`}\n`);
    process.stderr.write(`  Time:       ${result.timingMs}ms\n`);

    const cacheLine = formatCacheStats(result.cacheStats);
    if (cacheLine) process.stderr.write(`  Cache:      ${cacheLine}\n`);

    if (result.budget && !config.output.stdout) {
      process.stderr.write(kleur.dim(`\n  Tip: use --budget to change the token limit (default: 100k)\n`));
      process.stderr.write(kleur.dim(`  Tip: use --diff to pack only changed files (git mode)\n`));
    }

    // Excluded files list (cap at 20)
    if (result.excluded.length > 0) {
      process.stderr.write('\n  Excluded:\n');
      const cap = config.verbose ? result.excluded.length : 20;
      const shown = result.excluded.slice(0, cap);
      for (const ex of shown) {
        process.stderr.write(`    ${kleur.dim(ex.path)}  [${ex.reason}]\n`);
      }
      if (!config.verbose && result.excluded.length > 20) {
        process.stderr.write(`    ... and ${result.excluded.length - 20} more (--verbose to see all)\n`);
      }
    }

  } catch (err: unknown) {
    spinner.fail('Failed');
    if (err instanceof Error && err.message.toLowerCase().includes('not a git repository')) {
      process.stderr.write(kleur.red('\n  [repocode] error: not a git repository. Git flags require a git repo.\n'));
    } else {
      process.stderr.write(kleur.red(`\n  [repocode] error: ${err instanceof Error ? err.message : String(err)}\n`));
    }
    process.exit(1);
  }
}
