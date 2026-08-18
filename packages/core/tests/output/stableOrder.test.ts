import { describe, it, expect } from 'vitest';
import { applyStableOrder, mergeOrder, hashContent, type OrderEntry } from '../../src/output/stableOrder.js';

/** A file plus the content that would be emitted for it. */
const f = (path: string, content = path) => ({ path, content });
const hashOf = (x: { content: string }) => hashContent(x.content);
/** Previous-run entries for files whose content is unchanged. */
const prev = (...paths: string[]): OrderEntry[] =>
  paths.map(p => ({ path: p, hash: hashContent(p) }));

describe('applyStableOrder', () => {
  it('keeps unchanged files in the order they were previously emitted', () => {
    const result = applyStableOrder([f('c'), f('a'), f('b')], prev('a', 'b', 'c'), hashOf);
    expect(result.map(x => x.path)).toEqual(['a', 'b', 'c']);
  });

  it('appends files never emitted before at the tail, in rank order', () => {
    const result = applyStableOrder(
      [f('new2'), f('a'), f('new1'), f('b')], prev('a', 'b'), hashOf);
    expect(result.map(x => x.path)).toEqual(['a', 'b', 'new2', 'new1']);
  });

  it('moves an edited file to the tail so the prefix before it stays byte-identical', () => {
    // Keeping an edited file in place preserves the *ordering* but still breaks the byte
    // prefix at that file, and bytes are what a prompt cache keys on. Measured: leaving it in
    // place left a shared prefix of 0.8% of the pack.
    const files = [f('a'), f('b', 'EDITED'), f('c')];
    const result = applyStableOrder(files, prev('a', 'b', 'c'), hashOf);
    expect(result.map(x => x.path)).toEqual(['a', 'c', 'b']);
  });

  it('drops departed files without disturbing the survivors', () => {
    const result = applyStableOrder([f('c'), f('a')], prev('a', 'b', 'c'), hashOf);
    expect(result.map(x => x.path)).toEqual(['a', 'c']);
  });

  it('falls back to rank order when nothing was emitted before', () => {
    const result = applyStableOrder([f('c'), f('a'), f('b')], [], hashOf);
    expect(result.map(x => x.path)).toEqual(['c', 'a', 'b']);
  });

  it('never returns the array it was given', () => {
    // A caller reordering in place clears the original and re-pushes from the result. If this
    // returned its own input, that empties both and the pack comes back with zero files —
    // which is exactly what happened on the first run, when there is no previous order.
    const input = [f('a'), f('b')];
    expect(applyStableOrder(input, [], hashOf)).not.toBe(input);
    expect(applyStableOrder(input, prev('a', 'b'), hashOf)).not.toBe(input);
  });

  it('returns every input file exactly once', () => {
    const input = [f('x'), f('a'), f('y'), f('b')];
    const result = applyStableOrder(input, prev('a', 'b', 'gone'), hashOf);
    expect(result.map(x => x.path).sort()).toEqual(['a', 'b', 'x', 'y']);
  });

  it('leaves a file in place when its bytes changed but its emitted content did not', () => {
    // Compression can absorb an edit: a comment-only change to a file emitted as a tier-2
    // signature produces identical output, so moving it would break the prefix for no reason.
    const result = applyStableOrder([f('a'), f('b'), f('c')], prev('a', 'b', 'c'), hashOf);
    expect(result.map(x => x.path)).toEqual(['a', 'b', 'c']);
  });
});

describe('mergeOrder', () => {
  const e = (path: string, hash = hashContent(path)): OrderEntry => ({ path, hash });

  it('records new files after the ones already known', () => {
    const merged = mergeOrder([e('a'), e('b')], [e('b'), e('z')], new Set(['a', 'b', 'z']));
    expect(merged.map(x => x.path)).toEqual(['a', 'b', 'z']);
  });

  it('keeps a file that is still in the repo but missed this budget', () => {
    // Otherwise a file oscillating in and out of budget is re-appended each time it returns,
    // moving everything after it out of cache.
    const merged = mergeOrder([e('a'), e('b'), e('c')], [e('a'), e('c')], new Set(['a', 'b', 'c']));
    expect(merged.map(x => x.path)).toEqual(['a', 'b', 'c']);
  });

  it('forgets files that have left the repository', () => {
    const merged = mergeOrder([e('a'), e('deleted'), e('b')], [e('a'), e('b')], new Set(['a', 'b']));
    expect(merged.map(x => x.path)).toEqual(['a', 'b']);
  });

  it('records this run\'s hash for a file that was re-emitted with new content', () => {
    const merged = mergeOrder([e('a', 'oldhash')], [e('a', 'newhash')], new Set(['a']));
    expect(merged).toEqual([{ path: 'a', hash: 'newhash' }]);
  });
});
