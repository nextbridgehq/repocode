import { program } from 'commander';
import { stringify } from 'csv-stringify/sync';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { fetchSWEBench } from './dataset.js';
import { ensureRepo } from './git.js';
import { runRepocode } from './arms/repocode.js';
import { runRepomix, filesNamedInIssue } from './arms/repomix.js';
import { runBaseline } from './arms/baseline.js';
import { runOracle } from './arms/oracle.js';
import { runRandom } from './arms/random.js';

import { scoreRecall, parsePatchHunks, scoreHunks, type Retrieval } from './scoring.js';

/** Share of a gold file that has to survive for it to count as retrieved. Every arm is held
 *  to it identically. Measured retentions cluster either near 1.0 (delivered whole) or under
 *  0.35 (a stripped signature), so the exact value matters far less than having one at all —
 *  see results_phase1gate_precision.csv. */
const USABLE_RETENTION = 0.5;

interface ResultRow {
  instance_id: string;
  repo: string;
  budget: string;
  arm: string;
  gold_files_total: number;
  /** Old metric: the path appeared, whatever fraction of the file came with it. Kept so the
   *  historical numbers stay comparable and the gap between the two is visible. */
  recall_path_pct: number;
  /** The file was delivered with at least USABLE_RETENTION of its content. */
  recall_usable_pct: number;
  /** Mean share of each gold file that was actually delivered. */
  mean_gold_retention: number;
  files_included: number;
  /** Share of the patch's hunks whose changed lines are present in the delivered content. */
  hunks_covered_pct: number;
  /** 100 when every hunk of every gold file is covered — the patch's code is all in front of the agent. */
  patch_ready: number;
}

function makeRow(
  instance_id: string, repo: string, budget: string, arm: string,
  goldFiles: string[], selected: Retrieval[], sizeOf: (p: string) => number,
  hunksByFile: Record<string, string[][]>, readOriginal: (p: string) => string,
): ResultRow {
  const path_ = scoreRecall(goldFiles, selected, sizeOf, 0);
  const usable = scoreRecall(goldFiles, selected, sizeOf, USABLE_RETENTION);
  const rets = Object.values(usable.retentions);
  // An arm that sent no text delivered the file whole, or not at all.
  const byPath = new Map(selected.map(s => [s.path, s]));
  let hunkTotal = 0, hunkCovered = 0;
  for (const g of goldFiles) {
    const hunks = hunksByFile[g] ?? [];
    const sel = byPath.get(g);
    const text = sel ? (sel.content ?? (sel.chars >= sizeOf(g) ? readOriginal(g) : '')) : '';
    const s = scoreHunks(hunks, text);
    hunkTotal += s.total; hunkCovered += s.covered;
  }
  return {
    instance_id, repo, budget, arm,
    gold_files_total: goldFiles.length,
    recall_path_pct: Math.round(path_.pct * 10) / 10,
    recall_usable_pct: Math.round(usable.pct * 10) / 10,
    mean_gold_retention: rets.length ? Math.round(rets.reduce((s, r) => s + r, 0) / rets.length * 1000) / 1000 : 0,
    files_included: selected.length,
    hunks_covered_pct: hunkTotal ? Math.round(hunkCovered / hunkTotal * 1000) / 10 : 100,
    patch_ready: hunkCovered === hunkTotal ? 100 : 0,
  };
}

async function main() {
  program
    .option('--limit <number>', 'Limit the number of instances to run', parseInt)
    .option('--budgets <list>', 'Comma-separated token budgets (default: 25000,50000,100000)')
    .option('--arms <list>', 'Comma-separated arms to run (default: all). Oracle always runs as the harness check')
    .option('--ids-from <csv>', 'Only run instance_ids listed in the first column of this CSV')
    .parse(process.argv);

  const opts = program.opts();
  const limit = opts.limit;
  const armFilter: Set<string> | null = opts.arms ? new Set(String(opts.arms).split(',')) : null;
  const runArm = (arm: string) => !armFilter || armFilter.has(arm);

  let instances = await fetchSWEBench(process.env.BENCH_DATASET, opts.idsFrom ? undefined : limit);
  if (opts.idsFrom) {
    const ids = new Set(
      fs.readFileSync(opts.idsFrom, 'utf-8').split('\n').slice(1).map(l => l.split(',')[0]).filter(Boolean),
    );
    instances = instances.filter(i => ids.has(i.instance_id)).slice(0, limit ?? Infinity);
  }
  console.log(`Fetched ${instances.length} instances.`);

  const CACHE_DIR = path.resolve(__dirname, '../../.cache');
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  const STATS_DIR = path.resolve(__dirname, '../../stats');
  if (!fs.existsSync(STATS_DIR)) {
    fs.mkdirSync(STATS_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsFile = path.join(STATS_DIR, `results_${limit}instances_${timestamp}.csv`);

  const budgets: number[] = opts.budgets ? String(opts.budgets).split(',').map(Number) : [25000, 50000, 100000];
  const results: ResultRow[] = [];

  const saveResults = () => {
    const csv = stringify(results, { header: true });
    fs.writeFileSync(resultsFile, csv);
  };

  for (const instance of instances) {
    console.log(`\n--- Instance: ${instance.instance_id} (${instance.repo} @ ${instance.base_commit}) ---`);
    let repoDir: string;
    try {
      repoDir = await ensureRepo(instance.repo, instance.base_commit, CACHE_DIR);
    } catch (e) {
      console.error(`Failed to clone ${instance.repo}, skipping...`, e);
      continue;
    }

    const goldFiles = instance.gold_files;
    const hunksByFile = parsePatchHunks(instance.patch);
    console.log(`Gold files: ${goldFiles.length}`);

    for (const budgetTokens of budgets) {
      const budgetStr = `${budgetTokens / 1000}k`;
      console.log(`\n[Budget: ${budgetStr}]`);

      // On-disk size is the denominator for every arm's retention, so "how much of this file
      // did you actually deliver" means the same thing across all of them.
      const sizeOf = (p: string) => {
        try { return fs.statSync(path.join(repoDir, p)).size; } catch { return 0; }
      };
      const readOriginal = (p: string) => {
        try { return fs.readFileSync(path.join(repoDir, p), 'utf-8'); } catch { return ''; }
      };
      const row = (arm: string, selected: Retrieval[]) =>
        makeRow(instance.instance_id, instance.repo, budgetStr, arm, goldFiles, selected, sizeOf, hunksByFile, readOriginal);

      // 0. Oracle Arm — control. Anything below 100% here is a harness fault, not a ranking
      // one, and invalidates every other arm at this budget.
      const oracleRow = row('oracle', runOracle(goldFiles, budgetTokens, sizeOf));
      if (oracleRow.recall_usable_pct < 100) {
        console.warn(`  !! ORACLE ${oracleRow.recall_usable_pct.toFixed(0)}% — harness fault at ${budgetStr}, other arms are not interpretable`);
      }
      results.push(oracleRow);
      saveResults();

      // 0.5. Random Arm — the chance line. Every ranked arm has to be read against this:
      // an ordering can be accidentally hostile to the metric (see the baseline arm), so a
      // low comparator score does not by itself mean a high score is skilful.
      if (runArm('random')) {
      const randomDraws = await runRandom(repoDir, budgetTokens);
      const drawRows = randomDraws.map(sel => row('random', sel));
      const mean = (k: keyof ResultRow) =>
        Math.round((drawRows.reduce((s, r) => s + (r[k] as number), 0) / drawRows.length) * 10) / 10;
      results.push({
        ...drawRows[0], arm: 'random',
        recall_path_pct: mean('recall_path_pct'),
        recall_usable_pct: mean('recall_usable_pct'),
        mean_gold_retention: mean('mean_gold_retention'),
        files_included: Math.round(mean('files_included')),
        hunks_covered_pct: mean('hunks_covered_pct'),
        patch_ready: mean('patch_ready'),
      });
      saveResults();
      }

      // 1. Baseline Arm
      if (runArm('baseline')) {
      console.log('Running Baseline...');
      results.push(row('baseline', await runBaseline(repoDir, budgetTokens)));
      saveResults();
      }

      // 2. Repomix Arm
      if (runArm('repomix')) {
      console.log('Running Repomix...');
      results.push(row('repomix', await runRepomix(repoDir, budgetTokens)));
      saveResults();
      }

      // 2b. Repomix with hints. A user who reads the issue can hand Repomix the files it names via
      // --include; this is that user, uncompressed so the files arrive whole. An issue that names
      // no file leaves Repomix with nothing to narrow on, so it falls back to the plain arm.
      if (runArm('repomix-hinted')) {
      console.log('Running Repomix (hinted)...');
      const named = filesNamedInIssue(instance.problem_statement, repoDir);
      console.log(`  Issue names ${named.length} repo file(s)`);
      const hinted = named.length
        ? await runRepomix(repoDir, budgetTokens, { include: named, compress: false })
        : await runRepomix(repoDir, budgetTokens);
      results.push(row('repomix-hinted', hinted));
      saveResults();
      }

      // 3. RepoCode (No Query)
      if (runArm('repocode-base')) {
      console.log('Running RepoCode (Base)...');
      const repocodeBase = await runRepocode(repoDir, budgetTokens.toString());
      if (repocodeBase.diagnostics) {
        console.log(`  Included: ${repocodeBase.diagnostics.totalIncluded}, Excluded: ${repocodeBase.diagnostics.totalExcluded}`);
      }
      const baseRow = row('repocode-base', repocodeBase.files);
      console.log(`  gold retention: ${baseRow.mean_gold_retention} (levels: ${goldFiles.map(g => repocodeBase.levels[g] ?? 'absent').join(',')})`);
      results.push(baseRow);
      saveResults();
      }

      // 4. RepoCode (Query)
      if (runArm('repocode-query')) {
      console.log('Running RepoCode (Query)...');
      // We take just the title (first line) of the problem statement to avoid blowing up the cli args size limits
      const queryStr = instance.problem_statement.split('\n')[0].trim();
      const repocodeQuery = await runRepocode(repoDir, budgetTokens.toString(), queryStr);
      results.push(row('repocode-query', repocodeQuery.files));
      saveResults();
      }

      // 5. RepoCode (Query = whole issue). What an agent actually has; too long for an argument.
      if (runArm('repocode-query-full')) {
      console.log('Running RepoCode (Query, full issue)...');
      const qf = path.join(CACHE_DIR, `query-${instance.instance_id}.md`);
      fs.writeFileSync(qf, instance.problem_statement);
      const full = await runRepocode(repoDir, budgetTokens.toString(), undefined, qf);
      results.push(row('repocode-query-full', full.files));
      saveResults();
      }
    }
  }

  console.log(`\nDone! Wrote results to ${resultsFile}`);
}

main().catch(console.error);
