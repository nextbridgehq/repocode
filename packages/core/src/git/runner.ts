import { execFileSync } from 'child_process';

export function runGit(root: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    const stderr = (err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? '';
    const msg = err instanceof Error ? (stderr || err.message) : String(err);
    throw new Error(`git ${args[0]} failed: ${msg.trim()}`);
  }
}
