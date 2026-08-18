import { describe, it, expect } from 'vitest';
import { MODEL_BUDGETS, MODEL_TABLE_VERIFIED_ON, budgetForModel, knownModels } from '../../src/config/modelBudgets.js';

describe('budgetForModel', () => {
  it('leaves room for the response and the surrounding conversation', () => {
    // claude-opus-5: 1,000,000 context, 128,000 max output.
    // 1,000,000 - 128,000 - 150,000 (15% conversation reserve) = 722,000
    expect(budgetForModel('claude-opus-5')).toBe(722_000);
  });

  it('scales the reserve with the context window rather than using a fixed slice', () => {
    // haiku-4-5 is a 200k model: 200,000 - 64,000 - 30,000 = 106,000.
    // A fixed reserve tuned for a 1M model would leave nothing here.
    expect(budgetForModel('claude-haiku-4-5')).toBe(106_000);
  });

  it('resolves aliases to the same budget as the canonical id', () => {
    expect(budgetForModel('opus')).toBe(budgetForModel('claude-opus-5'));
    expect(budgetForModel('sonnet')).toBe(budgetForModel('claude-sonnet-5'));
  });

  it('is case- and whitespace-insensitive, because users type these by hand', () => {
    expect(budgetForModel('  Claude-Opus-5 ')).toBe(budgetForModel('claude-opus-5'));
  });

  it('returns null for an unknown model rather than inventing a budget', () => {
    expect(budgetForModel('gpt-9-ultra')).toBeNull();
  });

  it('never returns a budget at or below zero', () => {
    for (const name of knownModels()) {
      const budget = budgetForModel(name);
      expect(budget, name).not.toBeNull();
      expect(budget!, name).toBeGreaterThan(0);
    }
  });

  it('keeps every budget strictly under its own context window', () => {
    for (const [name, spec] of Object.entries(MODEL_BUDGETS)) {
      expect(budgetForModel(name)!, name).toBeLessThan(spec.contextWindow);
    }
  });

  it('carries a verification date, because these numbers go stale', () => {
    // The registry is a snapshot of vendor documentation, not a fact about the
    // tool. Shipping it without a date is how a package quietly serves numbers
    // that stopped being true two releases ago.
    expect(MODEL_TABLE_VERIFIED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('lists known models sorted, so --help and error text are stable', () => {
    const names = knownModels();
    expect(names).toEqual([...names].sort());
    expect(names).toContain('claude-opus-5');
  });
});
