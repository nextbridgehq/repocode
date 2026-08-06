import path from 'path';
import type { SecurityFinding, SecurityMode } from '../types.js';

export interface SecurityScanResult {
  findings: SecurityFinding[];
  redactedContent?: string;
}

// @secretlint/* is a large dependency tree that is only needed when a scan
// actually runs. These are `typeof import(...)` types, so nothing is imported at
// module load — a pack with security disabled never pays to load it. The
// promises below memoise the real import.
type ConfigLoaderModule = typeof import('@secretlint/config-loader');
type SecretlintCoreModule = typeof import('@secretlint/core');
type SecretlintConfig =
  Awaited<ReturnType<ConfigLoaderModule['loadPackagesFromConfigDescriptor']>>['config'];

let modulesPromise: Promise<{ loader: ConfigLoaderModule; core: SecretlintCoreModule } | null> | undefined;
let warnedMissingSecretlint = false;

function getSecretlintModules(): Promise<{ loader: ConfigLoaderModule; core: SecretlintCoreModule } | null> {
  if (!modulesPromise) {
    modulesPromise = Promise.all([
      import('@secretlint/config-loader'),
      import('@secretlint/core'),
    ]).then(([loader, core]) => ({ loader, core })).catch(() => {
      if (!warnedMissingSecretlint) {
        process.stderr.write(`[repocode] warning: @secretlint packages not installed; secret scanning disabled. Install them with: npm install @secretlint/core @secretlint/config-loader @secretlint/secretlint-rule-preset-recommend\n`);
        warnedMissingSecretlint = true;
      }
      return null;
    });
  }
  return modulesPromise;
}

let configPromise: Promise<SecretlintConfig | null> | undefined;

function getSecretlintConfig(): Promise<SecretlintConfig | null> {
  if (!configPromise) {
    configPromise = getSecretlintModules()
      .then(modules => {
        if (!modules) return null;
        return modules.loader.loadPackagesFromConfigDescriptor({
          configDescriptor: {
            rules: [
              {
                id: '@secretlint/secretlint-rule-preset-recommend',
                rules: [
                  { id: '@secretlint/secretlint-rule-aws', options: { enableIDScanRule: true } },
                ],
              },
            ],
          },
        });
      })
      .then(result => result ? result.config : null);
  }
  return configPromise;
}

function patternNameFromRuleId(ruleId: string): string {
  return ruleId.replace(/^@secretlint\/secretlint-rule-/, '');
}

export async function scanForSecrets(
  filePath: string,
  content: string,
  mode: SecurityMode = 'warn'
): Promise<SecurityScanResult> {
  const modules = await getSecretlintModules();
  if (!modules) return { findings: [] };
  
  const { core } = modules;
  const config = await getSecretlintConfig();
  if (!config) return { findings: [] };

  const result = await core.lintSource({
    source: {
      filePath,
      content,
      ext: path.extname(filePath),
      contentType: 'text',
    },
    options: { config, maskSecrets: true },
  });

  const findings: SecurityFinding[] = result.messages.map(message => ({
    filePath,
    patternName: patternNameFromRuleId(message.ruleId),
    line: message.loc.start.line,
  }));

  if (mode === 'redact' && result.messages.length > 0) {
    const sorted = [...result.messages].sort((a, b) => b.range[0] - a.range[0]);
    let redacted = content;
    for (const message of sorted) {
      redacted = redacted.slice(0, message.range[0]) + '[REDACTED]' + redacted.slice(message.range[1]);
    }
    return { findings, redactedContent: redacted };
  }

  return { findings };
}
