const BUDGET_REASONS = new Set([
  'exceeds-budget',
  'exceeds-budget-after-compression',
  'below-candidate-cut',
]);

export function classifyExclusions(excluded) {
  const budgetDriven = [];
  const other = [];
  for (const entry of excluded) {
    (BUDGET_REASONS.has(entry.reason) ? budgetDriven : other).push(entry);
  }
  return { budgetDriven, other };
}

export function decideFits(classified) {
  return classified.budgetDriven.length === 0;
}

// `actions/checkout` fetches the PR's base branch into refs/remotes/origin/<name> only — it
// never creates a bare local `<name>`. The CLI passes its base straight to `git merge-base`,
// so an unprefixed ref fails with "Not a valid object name" in exactly the pull_request
// context this action exists for. Resolve to a ref that provably exists before handing it over.
export function resolveBase(explicitBase, envRef, refExists) {
  if (explicitBase) return explicitBase;
  if (!envRef) return '';
  const originRef = `origin/${envRef}`;
  if (refExists(originRef)) return originRef;
  if (refExists(envRef)) return envRef;
  // Neither resolves: return nothing and let the tool-error path report the real problem
  // rather than silently diffing against something unintended.
  return '';
}

export function buildArgs({ path, budget, model, base }) {
  const args = [path || '.', '--pr'];
  if (base) args.push('--base', base);
  if (budget) args.push('--budget', budget);
  if (model) args.push('--model', model);
  args.push('--explain', '--format', 'json');
  return args;
}

// JSON that parses but isn't an ExplainReport would otherwise reach straight into
// report.excluded / report.summary.totalTokens and throw, which looks identical to a real
// budget failure to anything reading job status alone.
export function validateReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return 'report is not an object';
  }
  if (!Array.isArray(report.excluded)) {
    return 'report.excluded is missing or not an array';
  }
  if (!report.summary || typeof report.summary !== 'object') {
    return 'report.summary is missing';
  }
  if (typeof report.summary.totalTokens !== 'number') {
    return 'report.summary.totalTokens is missing or not a number';
  }
  return null;
}

// Every input below is concatenated into a shell command string on Windows, where Node must
// spawn `npx` with shell: true (it refuses to exec .cmd shims otherwise) and does no quoting
// of its own. A workflow wiring `base: ${{ github.head_ref }}` from an untrusted PR is the
// realistic vector — branch names may legitimately contain `&`, `|`, `;`, `$`, `(`, `)`.
const BUDGET_PATTERN = /^\d+[kKmM]?$/;
const NPM_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

// Free-form fields (paths, branch names, model names) get a blocklist rather than an
// allowlist, so real values with dots, slashes and hyphens keep working.
//
// Whitespace is blocked too, not just control characters: under shell: true on Windows, Node
// concatenates argv into one unquoted command string and cmd.exe re-tokenizes on whitespace, so
// a value with no other blocked character can still split into extra CLI arguments (e.g.
// `base: 'main --no-budget'` would pass without this and let Commander apply `--no-budget` last,
// silently disabling the budget check). No legitimate ref name, npm version, or repo-root path
// contains whitespace, so this rejects nothing valid.
const SHELL_METACHARACTERS = /[;&|`$(){}[\]<>^%!*?~#"'\\\s]/;

const FREEFORM_INPUTS = ['path', 'model', 'base'];

export function validateInputs(inputs) {
  for (const name of FREEFORM_INPUTS) {
    const value = inputs[name];
    if (!value) continue;
    const match = SHELL_METACHARACTERS.exec(value);
    if (match) {
      return `input "${name}" contains a disallowed shell metacharacter (${JSON.stringify(match[0])}): ${value}`;
    }
  }
  if (inputs.budget && !BUDGET_PATTERN.test(inputs.budget)) {
    return `input "budget" must be digits with an optional k/m suffix (e.g. 100000, 50k), got: ${inputs.budget}`;
  }
  if (inputs.repocodeVersion && !NPM_VERSION_PATTERN.test(inputs.repocodeVersion)) {
    return `input "repocode-version" must be an npm version or dist-tag (letters, digits, and . _ + -), got: ${inputs.repocodeVersion}`;
  }
  return null;
}

const EXCLUDED_DISPLAY_CAP = 20;

export function formatStepSummary(report, classified, fits) {
  const tokens = report.summary.totalTokens.toLocaleString();

  if (fits) {
    return `✅ **RepoCode budget check passed** — ${tokens} tokens, nothing excluded for budget reasons.`;
  }

  const lines = [
    `❌ **RepoCode budget check failed** — ${classified.budgetDriven.length} file(s) excluded because the PR's diff and its import context did not fit the budget.`,
    '',
    `Tokens: ${tokens}${report.budget?.maxTokens ? ` / ${report.budget.maxTokens.toLocaleString()}` : ''}`,
    '',
    '| File | Reason |',
    '|---|---|',
  ];

  const shown = classified.budgetDriven.slice(0, EXCLUDED_DISPLAY_CAP);
  for (const entry of shown) {
    lines.push(`| \`${entry.path}\` | ${entry.reason} |`);
  }
  if (classified.budgetDriven.length > EXCLUDED_DISPLAY_CAP) {
    lines.push('');
    lines.push(`...and ${classified.budgetDriven.length - EXCLUDED_DISPLAY_CAP} more.`);
  }

  return lines.join('\n');
}
