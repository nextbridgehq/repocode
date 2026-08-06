#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { packCommand } from './commands/pack.js';
import { mcpServerCommand } from './commands/mcpServer.js';
import { watchCommand } from './commands/watch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8')
) as { version: string };

const program = new Command();

program
  .name('repocode')
  .description('Intelligent repository context engine for AI-assisted development')
  .version(version)
  .argument('[path]', 'Repository path to pack', '.')
  .option('-b, --budget <tokens>', 'Token budget (e.g. 50k, 100000)')
  .option('--no-budget', 'Disable token budget — include all files')
  .option('-f, --format <format>', 'Output format: xml|markdown|plain|json')
  .option('-o, --output <file>', 'Output file path (default: repocode-output.<ext>)')
  .option('--stdout', 'Write output to stdout instead of a file')
  .option('--copy', 'Copy output to clipboard')
  .option('--include <patterns...>', 'Include glob patterns')
  .option('-e, --exclude <patterns...>', 'Exclude glob patterns')
  .option('--no-security', 'Disable secret scanning')
  .option('--security-mode <mode>', 'Secret handling: warn|exclude|redact|fail', 'warn')
  .option('--compress <level>', 'Compression ceiling: none|tier1|tier2|tier3-llm|partial (default: partial)')
  .option('--no-compress', 'Disable all compression (alias for --compress none)')
  .option('--pin <paths...>', 'Always include these files (bypass candidate cut)')
  .option('--header <text>', 'Custom header text prepended to output')
  .option('--no-preamble', 'Omit AI preamble from output')
  .option('--max-file-size <size>', 'Skip files larger than this (e.g. 500k, 2m)')
  .option('--dry-run', 'Show what would be packed without writing output')
  .option('--explain', 'Print ranked file table to stderr and exit (implies --dry-run)')
  .option('--verbose', 'Show all excluded files in summary')
  .option('--init', 'Create a repocode.config.json in the current directory')
  .option('--diff', 'Uncommitted working-tree changes (staged + unstaged + untracked)')
  .option('--staged', 'Staged changes only')
  .option('--branch <name>', 'Diff of <name> vs auto-detected base branch')
  .option('--log <n>', 'Files touched in last n commits')
  .option('--range <from..to>', 'Files changed in a commit range (e.g. HEAD~3..HEAD)')
  .option('--pr', 'Auto-detect PR base from CI env or remote HEAD')
  .option('--base <branch>', 'Override base branch for --branch / --pr')
  .option('--no-deps', 'Disable import tracing for git modes (default: enabled)')
  .option('--remote <owner/repo>', 'Pack a GitHub repo without cloning (e.g. owner/repo or a GitHub URL)')
  .option('--remote-branch <branch>', 'Branch to fetch with --remote (default: the repo\'s default branch)')
  .option('--remote-token <token>', 'GitHub token for --remote (overrides GITHUB_TOKEN env var)')
  .option('--stdin', 'Read a newline-separated file list from stdin instead of discovering files')
  .option('--graph-depth <n>', 'Import graph depth for transitive tracing and centrality scoring (default: 2; set to 0 to disable)')
  .option('--query <text>', 'Re-rank files by relevance to this query')
  .option('--query-mode <mode>', 'Query mode: keyword|semantic (default: keyword)')
  .option('--instruction <name>', 'Use a named instruction from the library')
  .option('--instruction-file <path>', 'Include instruction text from this file')
  .option('--instruction-text <text>', 'Use literal text as the instruction')
  .option('--list-instructions', 'List available instructions and exit')
  .option('--llm-provider <name>', 'LLM provider: openai|anthropic|ollama|custom')
  .option('--llm-model <name>', 'Model name for the LLM provider')
  .option('--llm-budget-tokens <n>', 'Max tokens per file for LLM compression (default: 8000)')
  .option('-i, --interactive', 'Open interactive TUI for file selection')
  .option('-w, --watch', 'Watch for file changes and keep the output file up to date')
  .option('--profile <name>', 'Load named profile in interactive mode (requires -i)')
  .option('--preset <name>', 'Activate a named preset from repocode.config.json or built-in')
  .option('--list-presets', 'List available presets and exit')
  .option('--save-preset <name>', 'Save current CLI flags as a named preset and exit')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.instruction && (opts.instruction.includes('/') || opts.instruction.includes('\\') || opts.instruction.endsWith('.md') || opts.instruction.endsWith('.txt'))) {
      process.stderr.write('[repocode] warning: --instruction <file> is deprecated. Use --instruction-file <path> instead.\n');
      opts.instructionFile = opts.instruction;
      delete opts.instruction;
    }
    if (opts.init) {
      const targetPath = (thisCommand.processedArgs[0] as string | undefined) ?? '.';
      const root = resolve(targetPath);
      const configPath = join(root, 'repocode.config.json');
      if (existsSync(configPath)) {
        process.stderr.write(`[repocode] error: repocode.config.json already exists at ${configPath}\n`);
        process.exit(1);
      }
      const starterConfig = {
        budget: { maxTokens: 100000 },
        output: { format: 'xml' },
        compress: 'partial',
        exclude: ['*.test.ts', '*.spec.ts'],
        graphDepth: 2,
      };
      writeFileSync(configPath, JSON.stringify(starterConfig, null, 2) + '\n', 'utf-8');
      process.stdout.write(`[repocode] Created ${configPath}\n`);
      process.exit(0);
    }
    if (opts.profile && !opts.interactive) {
      process.stderr.write('[repocode] error: --profile requires --interactive (-i)\n');
      process.exit(1);
    }
    if (opts.watch && opts.dryRun) {
      process.stderr.write('[repocode] error: --watch cannot be combined with --dry-run\n');
      process.exit(1);
    }
    if (opts.watch && opts.stdout) {
      process.stderr.write('[repocode] error: --watch cannot be combined with --stdout\n');
      process.exit(1);
    }
    if (opts.watch && opts.interactive) {
      process.stderr.write('[repocode] error: --watch cannot be combined with --interactive\n');
      process.exit(1);
    }
    if (opts.remote) {
      const targetPathArg = thisCommand.processedArgs[0] as string | undefined;
      if (targetPathArg && targetPathArg !== '.') {
        process.stderr.write('[repocode] error: --remote cannot be combined with a local path argument\n');
        process.exit(1);
      }
      const gitModeFlags = ['diff', 'staged', 'branch', 'log', 'range', 'pr'] as const;
      if (gitModeFlags.some(f => opts[f])) {
        process.stderr.write('[repocode] error: --remote packs a snapshot and has no commit history — git-history flags aren\'t supported together with --remote.\n');
        process.exit(1);
      }
      if (opts.watch) {
        process.stderr.write('[repocode] error: --remote cannot be combined with --watch — there is nothing to watch in a one-time snapshot.\n');
        process.exit(1);
      }
    }
    if (opts.stdin) {
      if (opts.include || opts.exclude) {
        process.stderr.write('[repocode] error: --stdin cannot be combined with --include or --exclude\n');
        process.exit(1);
      }
      const gitModeFlags = ['diff', 'staged', 'branch', 'log', 'range', 'pr'] as const;
      if (gitModeFlags.some(f => opts[f])) {
        process.stderr.write('[repocode] error: --stdin cannot be combined with a git-history mode\n');
        process.exit(1);
      }
      if (opts.remote) {
        process.stderr.write('[repocode] error: --stdin cannot be combined with --remote\n');
        process.exit(1);
      }
      if (opts.interactive) {
        process.stderr.write('[repocode] error: --stdin cannot be combined with --interactive\n');
        process.exit(1);
      }
      if (opts.watch) {
        process.stderr.write('[repocode] error: --stdin cannot be combined with --watch\n');
        process.exit(1);
      }
    }
  })
  .action(async (targetPath: string, opts, command) => {
    const optionSource = (key: string) => command.getOptionValueSource(key);

    let resolvedPath = targetPath;
    let remoteCleanupDir: string | undefined;
    async function cleanupRemoteAndExit(code: number): Promise<never> {
      if (remoteCleanupDir) {
        const { rm } = await import('fs/promises');
        await rm(remoteCleanupDir, { recursive: true, force: true });
      }
      process.exit(code);
    }
    if (opts.remote) {
      const { parseRemoteSpec, resolveRemote } = await import('./remote/resolveRemote.js');
      try {
        const { owner, repo } = parseRemoteSpec(opts.remote);
        resolvedPath = await resolveRemote({
          owner,
          repo,
          branch: opts.remoteBranch,
          token: opts.remoteToken ?? process.env.GITHUB_TOKEN,
        });
        remoteCleanupDir = resolvedPath;
        opts.outputBaseDir = process.cwd();
      } catch (err) {
        process.stderr.write(`[repocode] error: ${(err as Error).message}\n`);
        process.exit(1);
      }
    }

    if (opts.stdin) {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      const raw = Buffer.concat(chunks).toString('utf-8');
      opts.stdinFiles = raw
        .split('\n')
        .map((line: string) => line.trim())
        .filter((line: string) => line.length > 0);
    }

    if (opts.listInstructions) {
      const root = resolve(resolvedPath ?? '.');
      const { listInstructions, loadConfig } = await import('@repocode/core');
      const config = await loadConfig(root, { root }, { allowJsConfig: true });
      const items = listInstructions(config.instructions ?? {});
      process.stdout.write('Available instructions:\n');
      for (const { name, description } of items) {
        process.stdout.write(`  ${name.padEnd(20)}${description ?? ''}\n`);
      }
      await cleanupRemoteAndExit(0);
    }

    if (opts.listPresets) {
      const root = resolve(resolvedPath ?? '.');
      const { listUserPresets } = await import('@repocode/core');
      const { user, builtin } = listUserPresets(root);
      const userEntries = Object.entries(user);
      if (userEntries.length > 0) {
        process.stdout.write(`User presets (repocode.config.json):\n`);
        for (const [name, preset] of userEntries) {
          process.stdout.write(`  ${name.padEnd(16)}${(preset as { description?: string }).description ?? ''}\n`);
        }
        process.stdout.write('\n');
      }
      process.stdout.write(`Built-in presets:\n`);
      for (const [name, preset] of Object.entries(builtin)) {
        process.stdout.write(`  ${name.padEnd(16)}${(preset as { description?: string }).description ?? ''}\n`);
      }
      await cleanupRemoteAndExit(0);
    }

    if (opts.savePreset) {
      const root = resolve(resolvedPath ?? '.');
      const { savePreset } = await import('@repocode/core');
      const { buildPresetData } = await import('./commands/buildConfig.js');
      const data = buildPresetData(opts);
      savePreset(opts.savePreset, data, root);
      process.stderr.write(`[repocode] Saved preset "${opts.savePreset}" to repocode.config.json\n`);
      await cleanupRemoteAndExit(0);
    }

    try {
      if (opts.watch) {
        await watchCommand(resolvedPath, opts, optionSource);
      } else if (opts.interactive) {
        // Imported here rather than at module load: the TUI pulls in ink+react,
        // which every non-interactive `repocode .` would otherwise pay to load.
        const { interactiveCommand } = await import('./commands/interactive.js');
        await interactiveCommand(resolvedPath, opts);
      } else {
        await packCommand(resolvedPath, opts, optionSource);
      }
    } finally {
      if (remoteCleanupDir) {
        const { rm } = await import('fs/promises');
        await rm(remoteCleanupDir, { recursive: true, force: true });
      }
    }
  });

program
  .command('mcp-server')
  .description('Start the MCP server on stdio (for Claude Desktop, Cursor, etc.)')
  .action(mcpServerCommand);

program.parse();
