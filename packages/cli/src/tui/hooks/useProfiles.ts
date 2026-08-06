import fs from 'fs';
import path from 'path';
import type { TUIFile } from '@repocode/core';

export interface Profile {
  name: string;
  files: string[];
}

const profilesDir = (root: string) =>
  path.join(root, '.repocode', 'profiles');

const profilePath = (root: string, name: string) =>
  path.join(profilesDir(root), `${name}.json`);

export function listProfiles(root: string): Profile[] {
  const dir = profilesDir(root);
  if (!fs.existsSync(dir)) return [];
  const results: Profile[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as unknown;
      if (
        data !== null &&
        typeof data === 'object' &&
        'name' in data && typeof (data as Record<string, unknown>).name === 'string' &&
        'files' in data && Array.isArray((data as Record<string, unknown>).files)
      ) {
        results.push(data as Profile);
      }
    } catch {
      // malformed JSON — skip silently (matches spec error handling)
    }
  }
  return results;
}

export function loadProfile(root: string, name: string, allFiles: TUIFile[]): Set<string> {
  const p = profilePath(root, name);
  if (!fs.existsSync(p)) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8')) as Profile;
    const allPaths = new Set(allFiles.map(f => f.path));
    return new Set(data.files.filter(f => allPaths.has(f)));
  } catch {
    return new Set();
  }
}

export function saveProfile(root: string, name: string, selected: Set<string>): void {
  const dir = profilesDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const profile: Profile = { name, files: [...selected].sort() };
  fs.writeFileSync(profilePath(root, name), JSON.stringify(profile, null, 2), 'utf-8');
}

export function profileExists(root: string, name: string): boolean {
  return fs.existsSync(profilePath(root, name));
}
