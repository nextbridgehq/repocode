import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function setup(): void {
  process.chdir(path.resolve(__dirname, '../..'));
}
