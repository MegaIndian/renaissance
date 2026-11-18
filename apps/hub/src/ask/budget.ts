/**
 * The budget meter (ADR 0007 point 6): cost per call from the SDK's usage fields and a public
 * price table, totals per profile per day, one monthly cap for the household.
 */
import type { Budget } from '@renaissance/core';

import type { UsageSample, UsageStore } from '../db/usage.js';

/** US dollars per million tokens (platform.claude.com/pricing, read 2026-11-17). */
export const PRICES: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

/** Unknown model ids are priced like Opus 5.5 so the meter never under-counts. */
export function priceFor(model: string) {
  const exact = PRICES[model];
  if (exact) return exact;
  const prefix = Object.keys(PRICES).find((k) => model.startsWith(k));
  return (prefix && PRICES[prefix]) || PRICES['claude-opus-5-5']!;
}

export interface RawUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function sampleFrom(model: string, usage: RawUsage): UsageSample {
  const p = priceFor(model);
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const costUsd =
    (usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      cacheRead * p.cacheRead +
      cacheWrite * p.cacheWrite) /
    1_000_000;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    costUsd,
  };
}

/**
 * What one intent call is assumed to cost until its usage is known: about 2,000 input tokens
 * (mostly cached) and 200 output on Opus 5.5 is a cent; this is a safe margin above it.
 */
export const RESERVED_CALL_USD = 0.02;

export interface Reservation {
  /** Gives the reserved amount back without recording anything (the call failed or was refused). */
  release(): void;
}

export function createBudget(options: { usage: UsageStore; capUsd: number; model: string }) {
  const { usage, capUsd, model } = options;
  let inFlight = 0;
  const spentWithReservations = (now: Date): number =>
    usage.monthSpent(now) + inFlight * RESERVED_CALL_USD;
  return {
    /** True when the household may still call the model this month, counting calls in flight. */
    allows(now = new Date()): boolean {
      return capUsd > 0 && spentWithReservations(now) < capUsd;
    },
    /**
     * Holds an estimated cost for one call so concurrent asks cannot all pass at the cap; null
     * when the cap is reached. Settled by `record()` or given back by `release()`.
     */
    reserve(now = new Date()): Reservation | null {
      if (!this.allows(now)) return null;
      inFlight += 1;
      let open = true;
      return {
        release: () => {
          if (!open) return;
          open = false;
          inFlight -= 1;
        },
      };
    },
    inFlight(): number {
      return inFlight;
    },
    record(
      profile: string,
      raw: RawUsage,
      reservation?: Reservation | null,
      now = new Date(),
    ): UsageSample {
      const sample = sampleFrom(model, raw);
      usage.record(profile, sample, now);
      reservation?.release();
      return sample;
    },
    report(profile: string | 'house', now = new Date()): Budget {
      const spent = usage.monthSpent(now);
      return {
        model,
        month: now.toISOString().slice(0, 7),
        capUsd,
        spentUsd: spent,
        remainingUsd: Math.max(0, capUsd - spent),
        off: !(capUsd > 0 && spent < capUsd),
        days: usage.days(profile, now),
      };
    },
  };
}
export type BudgetMeter = ReturnType<typeof createBudget>;
