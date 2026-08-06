import { startWatch, atomicWriteFileSync } from '@repocode/core';
import type { PackResult, OutputFormat } from '@repocode/core';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import kleur from 'kleur';
import { buildPackConfig, type CLIOptions } from './buildConfig.js';
import { resolveOutputPath } from '../output/resolveOutputPath.js';

const FORMAT_EXTENSIONS: Record<OutputFormat, string> = {
  xml: '.xml', markdown: '.md', plain: '.txt', json: '.json',
};

function hashOutput(output: string): string {
  return crypto.createHash('sha256').update(output, 'utf-8').digest('hex');
}

function timestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

export async function watchCommand(
  targetPath: string,
  opts: CLIOptions,
  optionSource?: (key: string) => string | undefined,
): Promise<void> {
  const config = await buildPackConfig(targetPath, opts, optionSource);
  const root = config.root;

  const format = config.output.format;
  const defaultFilename = `repocode-output${FORMAT_EXTENSIONS[format]}`;
  const outPath = config.output.filePath ?? defaultFilename;
  const fullOutPath = resolveOutputPath(root, outPath);

  let lastOutputHash: string | null = null;
  let isFirstRepack = true;

  // Register signal handlers BEFORE startWatch() so they are active when the
  // initial "Watching" log line is printed (which fires inside startWatch, before
  // it returns). Without this, a SIGTERM arriving right after that log line would
  // find no handler registered and use the default kill behaviour (exit code null).
  let handle: Awaited<ReturnType<typeof startWatch>> | undefined;
  const shutdown = async (): Promise<void> => {
    try {
      if (handle) await handle.stop();
    } catch {
      // ignore cleanup errors so process.exit(0) is always reached
    }
    process.stderr.write('[repocode] Watch stopped.\n');
    process.exit(0);
  };
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });

  handle = await startWatch({
    config,
    onRepack: (result: PackResult, changedPaths: string[]) => {
      const outputHash = hashOutput(result.output);
      const tokenLine = `${result.included.length} files, ${result.totalTokens.toLocaleString()} tokens`;

      if (outputHash === lastOutputHash) {
        process.stderr.write(`[${timestamp()}] Repacked: ${changedPaths.length} changed → no output change (${result.timingMs}ms)\n`);
        return;
      }

      atomicWriteFileSync(fullOutPath, result.output);
      lastOutputHash = outputHash;

      if (isFirstRepack) {
        isFirstRepack = false;
        process.stderr.write(`[${timestamp()}] Watching ${root} — ${tokenLine} (${result.timingMs}ms). Press Ctrl+C to stop.\n`);
      } else {
        process.stderr.write(`[${timestamp()}] Repacked: ${changedPaths.length} changed → ${tokenLine} (${result.timingMs}ms)\n`);
      }
    },
    onError: (err: Error) => {
      const message = err.message.includes('ENOSPC')
        ? `${err.message}\nRun: echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p`
        : err.message;
      process.stderr.write(kleur.red(`[repocode] Watch error: ${message}\n`));
    },
  });
}
