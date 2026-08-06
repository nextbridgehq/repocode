import { describe, it, expect } from 'vitest';
import { atomicWriteFileSync } from '../../src/utils/atomicWrite.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('atomicWriteFileSync', () => {
  it('writes content to the target file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-atomic-'));
    const file = path.join(dir, 'out.txt');
    atomicWriteFileSync(file, 'hello');
    expect(fs.readFileSync(file, 'utf-8')).toBe('hello');
    fs.rmSync(dir, { recursive: true });
  });

  it('leaves no .tmp files on success', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-atomic-'));
    const file = path.join(dir, 'out.txt');
    atomicWriteFileSync(file, 'world');
    const files = fs.readdirSync(dir);
    expect(files.every(f => !f.endsWith('.tmp'))).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it('overwrites existing file content', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-atomic-'));
    const file = path.join(dir, 'out.txt');
    fs.writeFileSync(file, 'old');
    atomicWriteFileSync(file, 'new');
    expect(fs.readFileSync(file, 'utf-8')).toBe('new');
    fs.rmSync(dir, { recursive: true });
  });
});
