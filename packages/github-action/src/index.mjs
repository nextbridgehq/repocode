import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import {
  buildArgs,
  classifyExclusions,
  decideFits,
  formatStepSummary,
  resolveBase,
  validateInputs,
  validateReport,
} from './classify.mjs';

function getInput(name) {
  const key = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`;
  return (process.env[key] ?? '').trim();
}

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
}

function writeStepSummary(markdown) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    appendFileSync(summaryFile, markdown + '\n');
  }
}

// Never calls process.exit: on a pipe (what the runner attaches) writes are asynchronous and
// exit() does not wait for them, which can drop the ::error:: annotation — the only output
// this path produces. Set the code and return instead.
function fail(message) {
  console.error(`::error::${message}`);
  writeStepSummary(`❌ **RepoCode budget check could not run** — ${message}`);
  process.exitCode = 1;
}

// No shell here, deliberately. git is a real executable on every platform (unlike the npx
// .cmd shim below), so this both avoids cmd.exe eating the `^` in `^{commit}` and keeps
// GITHUB_BASE_REF out of any shell command string.
function refExists(ref, cwd) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { stdio: 'ignore', cwd });
    return true;
  } catch {
    return false;
  }
}

function main() {
  try {
    const inputs = {
      path: getInput('path') || '.',
      budget: getInput('budget'),
      model: getInput('model'),
      base: getInput('base'),
      repocodeVersion: getInput('repocode-version') || 'latest',
    };

    const invalidInput = validateInputs(inputs);
    if (invalidInput) {
      fail(invalidInput);
      return;
    }

    // Resolve the base ourselves and always pass it explicitly, rather than leaning on the
    // CLI's own GITHUB_BASE_REF fallback, which uses the bare ref name that actions/checkout
    // never creates locally.
    inputs.base = resolveBase(inputs.base, process.env.GITHUB_BASE_REF, ref => refExists(ref, inputs.path));

    // The resolved value can come from GITHUB_BASE_REF rather than the validated input, and a
    // git ref name may legally contain `;`, `&` and `$`. Re-check before it reaches the shell.
    const invalidBase = validateInputs(inputs);
    if (invalidBase) {
      fail(invalidBase);
      return;
    }

    const args = buildArgs(inputs);
    const npxArgs = ['--yes', `repocode@${inputs.repocodeVersion}`, ...args];

    let stdout;
    try {
      stdout = execFileSync('npx', npxArgs, {
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024 * 50,
        shell: process.platform === 'win32',
      });
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString() : '';
      fail(`repocode failed to run: ${stderr || err.message}`);
      return;
    }

    let report;
    try {
      report = JSON.parse(stdout);
    } catch {
      fail(`could not parse repocode output as JSON:\n${stdout}`);
      return;
    }

    const invalidReport = validateReport(report);
    if (invalidReport) {
      fail(`repocode returned an unexpected report shape: ${invalidReport}`);
      return;
    }

    const classified = classifyExclusions(report.excluded);
    const fits = decideFits(classified);
    const summary = formatStepSummary(report, classified, fits);

    setOutput('fits', String(fits));
    setOutput('excluded-count', String(classified.budgetDriven.length));
    setOutput('total-tokens', String(report.summary.totalTokens));
    writeStepSummary(summary);

    console.log(summary);

    process.exitCode = fits ? 0 : 1;
  } catch (err) {
    // Nothing should exit through an uncaught exception with a raw stack trace.
    fail(`unexpected error: ${err && err.message ? err.message : String(err)}`);
  }
}

main();
