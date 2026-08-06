import path from 'path';
import fs from 'fs';
import type { RepoCodeConfig, PresetConfig } from '../types.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { BUILTIN_PRESETS } from './builtinPresets.js';

const VALID_CONFIG_KEYS = new Set([
  'root', 'maxFileSizeBytes', 'output', 'budget', 'include', 'exclude',
  'ignore', 'ranking', 'security', 'compress', 'verbose', 'dryRun',
  'git', 'graphDepth', 'presets',
  'llm', 'query', 'queryConfig', 'instruction', 'instructions',
]);

function warnUnknownKeys(fileConfig: Partial<RepoCodeConfig>, source: string): void {
  for (const key of Object.keys(fileConfig as Record<string, unknown>)) {
    if (!VALID_CONFIG_KEYS.has(key)) {
      process.stderr.write(
        `[repocode] warning: unknown config key "${key}" in ${source} (ignored)\n`
      );
    }
  }
}

function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const val = override[key];
    if (val !== undefined) {
      if (typeof val === 'object' && val !== null && !Array.isArray(val) && typeof base[key] === 'object' && base[key] !== null) {
        result[key] = deepMerge(base[key] as object, val as object) as T[typeof key];
      } else {
        result[key] = val as T[typeof key];
      }
    }
  }
  return result;
}

function readFileConfig(root: string): Partial<RepoCodeConfig> & { presets?: Record<string, PresetConfig> } {
  for (const name of ['repocode.config.json', 'repocode.config.js']) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) {
      try {
        if (name.endsWith('.json')) {
          const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
          warnUnknownKeys(raw, name);
          return raw;
        } else {
          // JS config is async — skip here, handled in loadConfig
          return {};
        }
      } catch (e) {
        process.stderr.write(`[repocode] warning: could not load ${name}: ${e}\n`);
      }
      break;
    }
  }
  return {};
}

export interface LoadConfigOptions {
  /** Named preset to layer between file config and CLI overrides. */
  preset?: string;
  /**
   * Permit executing `repocode.config.js`. Defaults to `false`: loading a JS
   * config runs arbitrary code from the target directory, so callers must opt in
   * deliberately. The CLI enables it (same trust model as eslint/webpack configs
   * — the user chose to run a command in that directory); the MCP server must
   * not, since it packs repositories the user never explicitly invoked a tool in.
   */
  allowJsConfig?: boolean;
}

export async function loadConfig(
  root: string,
  cliOverrides: Partial<RepoCodeConfig>,
  options?: LoadConfigOptions,
): Promise<RepoCodeConfig> {
  const presetName = options?.preset;
  const rawFile = readFileConfig(root);

  // Separate presets metadata from the actual file config
  const { presets: userPresets, ...fileConfigRest } = rawFile as Record<string, unknown> & { presets?: Record<string, PresetConfig> };
  let fileConfig: Partial<RepoCodeConfig> = fileConfigRest as Partial<RepoCodeConfig>;

  // Handle JS config (async import) — only when JSON produced no result
  const jsConfigPath = path.join(root, 'repocode.config.js');
  if (Object.keys(fileConfig).length === 0 && fs.existsSync(jsConfigPath)) {
    if (options?.allowJsConfig !== true) {
      process.stderr.write(
        `[repocode] warning: repocode.config.js found but JS config execution is disabled in this mode. Use repocode.config.json instead.\n`
      );
    } else {
      try {
        const mod = await import(jsConfigPath);
        const loaded = mod.default ?? mod;
        const { presets: _jsPresets, ...rest } = loaded;
        fileConfig = rest;
        if (_jsPresets) Object.assign(userPresets ?? {}, _jsPresets);
        warnUnknownKeys(loaded, 'repocode.config.js');
      } catch (e) {
        process.stderr.write(`[repocode] warning: could not load repocode.config.js: ${e}\n`);
      }
    }
  }

  // Preset resolution: user presets shadow built-ins of the same name
  let preset: PresetConfig | null = null;
  if (presetName) {
    preset = (userPresets ?? {})[presetName] ?? BUILTIN_PRESETS[presetName] ?? null;
    if (!preset) {
      const names = [
        ...Object.keys(userPresets ?? {}),
        ...Object.keys(BUILTIN_PRESETS),
      ].join(', ');
      throw new Error(`Unknown preset "${presetName}". Available: ${names || 'none'}`);
    }
  }

  // Layer 1: DEFAULT_CONFIG + root
  // Layer 2: file config (without presets key)
  const base = deepMerge({ ...DEFAULT_CONFIG, root }, fileConfig);

  // Layer 3: preset (without description)
  let withPreset: RepoCodeConfig = base;
  if (preset) {
    const { description: _d, ...presetData } = preset as PresetConfig & { description?: string };
    void _d;
    withPreset = deepMerge(base, presetData as Partial<RepoCodeConfig>);
  }

  // Layer 4: CLI overrides
  return deepMerge(withPreset, cliOverrides);
}

export function savePreset(
  name: string,
  data: Partial<RepoCodeConfig>,
  root: string,
): void {
  const configPath = path.join(root, 'repocode.config.json');
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  if (!existing['presets']) {
    existing['presets'] = {};
  }
  (existing['presets'] as Record<string, unknown>)[name] = {
    ...data,
    description: new Date().toISOString().split('T')[0],
  };
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n');
}

export function listUserPresets(root: string): {
  user: Record<string, PresetConfig>;
  builtin: Record<string, PresetConfig>;
} {
  const rawFile = readFileConfig(root);
  return {
    user: rawFile.presets ?? {},
    builtin: BUILTIN_PRESETS,
  };
}
