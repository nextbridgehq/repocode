import type { TemplateContext } from './types.js';

export function renderTemplate(template: string, ctx: TemplateContext): string {
  return template
    .replace(/\{\{files_count\}\}/g, String(ctx.filesCount))
    .replace(/\{\{git_branch\}\}/g, ctx.gitBranch)
    .replace(/\{\{repo_name\}\}/g, ctx.repoName)
    .replace(/\{\{date\}\}/g, ctx.date);
}
