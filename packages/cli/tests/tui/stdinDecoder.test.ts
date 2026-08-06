import { describe, it, expect } from 'vitest';
import { createStdinDecoder } from '../../src/tui/stdinDecoder.js';

describe('createStdinDecoder', () => {
  it('decodes a complete single-byte chunk unchanged', () => {
    const decode = createStdinDecoder();
    expect(decode(Buffer.from('a'))).toBe('a');
  });

  it('decodes a complete multi-byte UTF-8 character in one chunk', () => {
    const decode = createStdinDecoder();
    const euroSign = Buffer.from('€', 'utf-8'); // 3 bytes: 0xE2 0x82 0xAC
    expect(decode(euroSign)).toBe('€');
  });

  it('correctly reassembles a multi-byte UTF-8 character split across two chunks', () => {
    const decode = createStdinDecoder();
    const full = Buffer.from('€', 'utf-8'); // [0xE2, 0x82, 0xAC]
    const first = full.subarray(0, 2);  // [0xE2, 0x82] — incomplete
    const second = full.subarray(2);    // [0xAC] — completes the sequence

    const firstOutput = decode(first);
    const secondOutput = decode(second);

    expect(firstOutput).toBe(''); // incomplete sequence buffered, nothing emitted yet
    expect(secondOutput).toBe('€'); // completed on the next chunk
  });

  it('passes plain strings through unchanged (ink-testing-library stdin.write path)', () => {
    const decode = createStdinDecoder();
    expect(decode(' ')).toBe(' ');
    expect(decode('n')).toBe('n');
    expect(decode('\r')).toBe('\r');
  });
});
