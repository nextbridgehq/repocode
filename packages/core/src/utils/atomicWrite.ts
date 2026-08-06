import fs from 'fs';
import { randomBytes } from 'crypto';

export function atomicWriteFileSync(filePath: string, content: string): void {
  const tmp = `${filePath}.${randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* best-effort cleanup */ }
    throw err;
  }
}
