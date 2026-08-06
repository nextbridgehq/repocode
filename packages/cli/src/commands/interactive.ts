import { render } from 'ink';
import React from 'react';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import kleur from 'kleur';
import ora from 'ora';
import { runPipelineForTUI, packFromSelection, loadConfig } from '@repocode/core';
import type { RepoCodeConfig, PackResult, TUIPipelineResult } from '@repocode/core';
import { App } from '../tui/App.js';
import { loadProfile } from '../tui/hooks/useProfiles.js';
import { resolveOutputPath } from '../output/resolveOutputPath.js';

function parseGitStatuses(root: string): Map<string, 'M' | 'A' | 'D' | '?'> {
  const result = new Map<string, 'M' | 'A' | 'D' | '?'>();
  try {
    const out = execSync('git status --porcelain', { cwd: root, encoding: 'utf-8' });
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const xy = line.slice(0, 2).trim();
      const p  = line.slice(3).trim().replace(/\\/g, '/');
      if (xy === '??')        result.set(p, '?');
      else if (xy.includes('A')) result.set(p, 'A');
      else if (xy.includes('D')) result.set(p, 'D');
      else                    result.set(p, 'M');
    }
  } catch { /* not a git repo or git unavailable — no badges */ }
  return result;
}

export async function interactiveCommand(
  targetPath: string,
  opts: { profile?: string; budget?: string | false; format?: string; output?: string; outputBaseDir?: string },
): Promise<void> {
  const root = path.resolve(targetPath ?? '.');

  const noBudget = opts.budget === false;
  const maxTokens = noBudget
    ? null
    : (opts.budget ? parseInt(opts.budget.replace(/k$/i, '000').replace(/m$/i, '000000'), 10) : undefined);

  const config = await loadConfig(root, {
    root,
    ...(maxTokens !== undefined ? { budget: { maxTokens } } : {}),
    ...(opts.format || opts.output
      ? { output: { ...(opts.format ? { format: opts.format } : {}), ...(opts.output ? { filePath: opts.output } : {}) } }
      : {}),
  } as Partial<RepoCodeConfig>, { allowJsConfig: true });

  const spinner = ora({ stream: process.stderr }).start('Analyzing project...');

  let tuiResult: TUIPipelineResult;
  try {
    tuiResult = await runPipelineForTUI(config);
  } catch (err) {
    spinner.fail('Analysis failed');
    process.stderr.write(kleur.red(`\n  [repocode] error: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }

  spinner.stop();

  // Load profile initial selection if --profile provided
  let initialSelected: Set<string> | undefined;
  let initialProfileName: string | undefined;
  if (opts.profile) {
    initialSelected = loadProfile(root, opts.profile, tuiResult.files);
    initialProfileName = opts.profile;
  }

  const gitStatuses = parseGitStatuses(root);

  // Ink renders to stdout; we wrote spinner to stderr — no contamination
  let resolveSelection: (selected: Set<string> | null) => void;
  const selectionPromise = new Promise<Set<string> | null>(resolve => {
    resolveSelection = resolve;
  });

  const { unmount } = render(
    React.createElement(App, {
      tuiResult,
      budget: config.budget.maxTokens,
      root,
      initialSelected,
      initialProfileName,
      gitStatuses,
      onPack:  (sel) => { unmount(); resolveSelection(sel); },
      onQuit:  ()    => { unmount(); resolveSelection(null); },
    }),
  );

  const selected = await selectionPromise;
  if (selected === null) return; // user quit

  // Fast-path assembly
  const packSpinner = ora({ stream: process.stderr }).start('Packing...');
  let result: PackResult;
  try {
    result = await packFromSelection(tuiResult.files, selected, config);
  } catch (err) {
    packSpinner.fail('Pack failed');
    process.stderr.write(kleur.red(`\n  [repocode] error: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }
  packSpinner.stop();

  // Write output (same logic as pack command)
  const FORMAT_EXTENSIONS: Record<string, string> = { xml: '.xml', markdown: '.md', plain: '.txt', json: '.json' };
  const defaultFilename = `repocode-output${FORMAT_EXTENSIONS[config.output.format] ?? '.xml'}`;
  const relativeOrAbsoluteOutPath = config.output.filePath ?? defaultFilename;
  const outPath = resolveOutputPath(opts.outputBaseDir ?? root, relativeOrAbsoluteOutPath);
  fs.writeFileSync(outPath, result.output, 'utf-8');

  const budgetLine = result.budget
    ? `${result.totalTokens.toLocaleString()} / ${result.budget.maxTokens.toLocaleString()} tokens`
    : `${result.totalTokens.toLocaleString()} tokens (no budget)`;

  process.stderr.write('\n');
  process.stderr.write(`  Files:   ${kleur.green(String(result.included.length))} packed\n`);
  process.stderr.write(`  Tokens:  ${kleur.yellow(budgetLine)}\n`);
  process.stderr.write(`  Output:  ${outPath}\n`);
}
