import fs from 'fs';
import path from 'path';
import type { InstructionConfig, InstructionDef } from '../types.js';
import { BUILTIN_INSTRUCTIONS } from './builtinInstructions.js';
import { renderTemplate } from './templateRenderer.js';
import type { TemplateContext } from './types.js';

export { BUILTIN_INSTRUCTIONS } from './builtinInstructions.js';
export type { TemplateContext } from './types.js';

export function listInstructions(userLibrary: Record<string, InstructionDef> = {}): Array<{ name: string; description: string }> {
  const all = { ...BUILTIN_INSTRUCTIONS, ...userLibrary };
  return Object.entries(all).map(([name, def]) => ({ name, description: def.description ?? '' }));
}

export function resolveInstruction(
  config: InstructionConfig | undefined,
  userLibrary: Record<string, InstructionDef>,
  ctx: TemplateContext,
  configDir: string,
): string | null {
  if (!config) return null;

  // Inline text
  if (config.text) return renderTemplate(config.text, ctx);

  // File path
  if (config.file) {
    const filePath = path.resolve(configDir, config.file);
    try {
      return renderTemplate(fs.readFileSync(filePath, 'utf-8'), ctx);
    } catch {
      process.stderr.write(`[repocode] warning: instruction file not found: ${filePath}\n`);
      return null;
    }
  }

  // Named lookup: user library first, then builtins
  if (config.name) {
    const def = userLibrary[config.name] ?? BUILTIN_INSTRUCTIONS[config.name];
    if (!def) {
      process.stderr.write(`[repocode] warning: unknown instruction name "${config.name}"\n`);
      return null;
    }
    if (def.text) return renderTemplate(def.text, ctx);
    if (def.file) {
      const filePath = path.resolve(configDir, def.file);
      try { return renderTemplate(fs.readFileSync(filePath, 'utf-8'), ctx); } catch { return null; }
    }
  }

  return null;
}
