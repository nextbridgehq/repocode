import { startServer } from '@repocode/mcp';

export async function mcpServerCommand(): Promise<void> {
  await startServer();
}
