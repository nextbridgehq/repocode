import { StringDecoder } from 'string_decoder';

/**
 * Real terminals in raw mode deliver stdin as Buffers, and the OS can split a
 * multi-byte UTF-8 character across two separate 'data' events (e.g. on paste
 * or fast typing). Decoding each Buffer independently with `.toString('utf8')`
 * turns a split sequence into two replacement characters instead of one glyph.
 * StringDecoder buffers incomplete trailing bytes across calls to avoid this.
 *
 * ink-testing-library's fake stdin delivers plain JS strings instead of
 * Buffers — those are passed through unchanged.
 */
export function createStdinDecoder(): (chunk: unknown) => string {
  const decoder = new StringDecoder('utf8');
  return (chunk: unknown): string => {
    if (typeof chunk === 'string') return chunk;
    if (Buffer.isBuffer(chunk)) return decoder.write(chunk);
    return String(chunk);
  };
}
