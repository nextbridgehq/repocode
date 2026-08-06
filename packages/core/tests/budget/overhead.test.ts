import { describe, it, expect } from 'vitest';
import { estimateOverhead } from '../../src/budget/overhead.js';

describe('estimateOverhead', () => {
  it('returns 50 + treeTokens + instructionTokens when headerText is empty', () => {
    // candidateCount=10 → treeTokens=ceil(10/10*50)=50; headerText=''; instructionContent=''
    const result = estimateOverhead(10, '', '');
    expect(result).toBe(50 + 50 + 0); // metadata + tree + instruction
  });

  it('adds estimateFast(headerText) to the result when headerText is non-empty', () => {
    // A 400-char header ≈ 100 tokens by estimateFast (400/4)
    const header = 'a'.repeat(400);
    const withHeader    = estimateOverhead(10, header, '');
    const withoutHeader = estimateOverhead(10, '', '');
    expect(withHeader).toBeGreaterThan(withoutHeader);
    // The difference should be ~100 tokens (400 chars / 4)
    expect(withHeader - withoutHeader).toBeGreaterThanOrEqual(80);
    expect(withHeader - withoutHeader).toBeLessThanOrEqual(120);
  });

  it('does NOT include headerText in the base 50-token metadata constant', () => {
    // Verify the old flat 200-constant is gone
    const result = estimateOverhead(0, '', '');
    expect(result).toBe(50); // 50 metadata + 0 tree + 0 instruction
    expect(result).not.toBe(200);
  });
});
