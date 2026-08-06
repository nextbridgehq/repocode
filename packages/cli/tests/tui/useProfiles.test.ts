import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { listProfiles, loadProfile, saveProfile } from '../../src/tui/hooks/useProfiles.js';
import type { TUIFile } from '@repocode/core';

let tmpDir: string;

function makeFile(filePath: string): TUIFile {
  return {
    path: filePath, absolutePath: `${tmpDir}/${filePath}`, size: 100,
    language: null, mtime: new Date(), isBinary: false, source: 'normal',
    score: 0.5, signalScores: { structural: 0, depth: 0, size: 0, extension: 0, keyword: 0, recency: 0 },
    content: 'x', tokens: 10,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-profiles-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('saveProfile + listProfiles', () => {
  it('saves a profile JSON and lists it', () => {
    saveProfile(tmpDir, 'auth', new Set(['src/auth.ts', 'src/session.ts']));
    const profiles = listProfiles(tmpDir);
    expect(profiles.map(p => p.name)).toContain('auth');
  });

  it('saved profile contains correct files array', () => {
    saveProfile(tmpDir, 'api', new Set(['src/routes.ts']));
    const profiles = listProfiles(tmpDir);
    const api = profiles.find(p => p.name === 'api');
    expect(api?.files).toEqual(['src/routes.ts']);
  });

  it('overwrites existing profile with same name', () => {
    saveProfile(tmpDir, 'auth', new Set(['src/old.ts']));
    saveProfile(tmpDir, 'auth', new Set(['src/new.ts']));
    const profiles = listProfiles(tmpDir);
    const auth = profiles.find(p => p.name === 'auth');
    expect(auth?.files).toEqual(['src/new.ts']);
  });
});

describe('loadProfile', () => {
  it('returns selected Set for files that exist in allFiles', () => {
    const allFiles = [makeFile('src/auth.ts'), makeFile('src/session.ts')];
    saveProfile(tmpDir, 'auth', new Set(['src/auth.ts', 'src/session.ts']));
    const selected = loadProfile(tmpDir, 'auth', allFiles);
    expect(selected).toEqual(new Set(['src/auth.ts', 'src/session.ts']));
  });

  it('silently skips files no longer in the project', () => {
    const allFiles = [makeFile('src/auth.ts')];
    saveProfile(tmpDir, 'auth', new Set(['src/auth.ts', 'src/deleted.ts']));
    const selected = loadProfile(tmpDir, 'auth', allFiles);
    expect(selected.has('src/deleted.ts')).toBe(false);
    expect(selected.has('src/auth.ts')).toBe(true);
  });

  it('returns empty Set for non-existent profile', () => {
    const allFiles = [makeFile('src/auth.ts')];
    const selected = loadProfile(tmpDir, 'nonexistent', allFiles);
    expect(selected.size).toBe(0);
  });
});

describe('listProfiles', () => {
  it('silently skips malformed JSON files', () => {
    fs.mkdirSync(path.join(tmpDir, '.repocode', 'profiles'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.repocode', 'profiles', 'bad.json'), 'NOT JSON');
    const profiles = listProfiles(tmpDir);
    expect(profiles.find(p => p.name === 'bad')).toBeUndefined();
  });
});
