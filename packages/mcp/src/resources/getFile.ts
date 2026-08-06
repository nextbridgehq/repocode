import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import fs, { realpathSync } from 'fs';
import path from 'path';

export function registerGetFile(server: McpServer): void {
  server.resource(
    'get_file',
    new ResourceTemplate('repocode:///{repoPath}/file/{filePath}', { list: undefined }),
    async (uri, { repoPath, filePath }) => {
      const repoRoot = path.resolve(decodeURIComponent(repoPath as string));
      const absFile = path.resolve(repoRoot, decodeURIComponent(filePath as string));

      // Lexical check first (catches plain path traversal)
      if (!absFile.startsWith(repoRoot + path.sep) && absFile !== repoRoot) {
        throw new McpError(ErrorCode.InvalidParams, `[repocode] error: path outside repository: ${absFile}`);
      }

      // Symlink check: resolve real paths to catch symlinks pointing outside root
      let realFile: string;
      let realRoot: string;
      try {
        realFile = realpathSync(absFile);
        realRoot = realpathSync(repoRoot);
      } catch {
        throw new McpError(ErrorCode.InvalidParams, `[repocode] error: cannot resolve path: ${filePath}`);
      }
      if (!realFile.startsWith(realRoot + path.sep) && realFile !== realRoot) {
        throw new McpError(ErrorCode.InvalidParams, `[repocode] error: path escapes repository via symlink: ${filePath}`);
      }

      // realpathSync above resolves the target as it existed at check time; O_NOFOLLOW narrows
      // (but does not eliminate — that requires kernel-level openat2/RESOLVE_NO_SYMLINKS support)
      // the remaining window where another process swaps the final path component for a symlink
      // between the check above and this read. Not meaningful on Windows, hence the platform guard.
      const openFlags = fs.constants.O_RDONLY | (process.platform !== 'win32' ? fs.constants.O_NOFOLLOW : 0);
      let text: string;
      try {
        const fd = fs.openSync(realFile, openFlags);
        try {
          text = fs.readFileSync(fd, 'utf-8');
        } finally {
          fs.closeSync(fd);
        }
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ELOOP') {
          throw new McpError(ErrorCode.InvalidParams, `[repocode] error: path escapes repository via symlink: ${filePath}`);
        }
        throw new McpError(
          ErrorCode.InvalidParams,
          `Cannot read file: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const ext = path.extname(absFile).slice(1).toLowerCase();
      const mimeType = ext === 'json' ? 'application/json' : 'text/plain';

      return {
        contents: [{ uri: uri.href, mimeType, text }],
      };
    },
  );
}
