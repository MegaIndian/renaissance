import { describe, expect, it } from 'vitest';

import { PRICES, createBudget, priceFor, sampleFrom } from '../src/ask/budget.js';
import { memoryStores, sahil } from './helpers.js';

describe('pricing', () => {
  it('prices known models, prefixes, and unknown ids like Opus 5.5', () => {
    expect(priceFor('claude-haiku-5-5')).toBe(PRICES['claude-haiku-5-5']);
    expect(priceFor('claude-sonnet-5-5-20270101')).toBe(PRICES['claude-sonnet-5-5']);
    expect(priceFor('mystery')).toBe(PRICES['claude-opus-5-5']);
  });

  it('computes cost from every usage field', () => {
    const s = sampleFrom('claude-opus-5-5', {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: null,
    });
    expect(s.costUsd).toBeCloseTo(4 + 2 + 0.2);
    expect(s.cacheWriteTokens).toBe(0);
  });
});

describe('budget meter', () => {
  it('allows calls until the monthly cap, then turns the model off', () => {
    const stores = memoryStores();
    const budget = createBudget({ usage: stores.usage, capUsd: 0.01, model: 'claude-opus-5-5' });
    const now = new Date('2026-11-17T12:00:00Z');
    expect(budget.allows(now)).toBe(true);
    budget.record(sahil.id, { input_tokens: 1000, output_tokens: 100 }, now);
    expect(budget.allows(now)).toBe(true);
    budget.record(sahil.id, { input_tokens: 2_000_000, output_tokens: 0 }, now);
    expect(budget.allows(now)).toBe(false);
    const report = budget.report(sahil.id, now);
    expect(report).toMatchObject({
      model: 'claude-opus-5-5',
      month: '2026-11',
      capUsd: 0.01,
      off: true,
      remainingUsd: 0,
    });
    expect(report.days[0]?.calls).toBe(2);
    expect(budget.report('house', now).days).toHaveLength(1);
    expect(budget.allows(new Date('2026-12-01T00:00:00Z'))).toBe(true);
    expect(createBudget({ usage: stores.usage, capUsd: 0, model: 'x' }).allows()).toBe(false);
  });
});
