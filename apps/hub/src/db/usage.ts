import type { DatabaseSync } from 'node:sqlite';

import type { Budget } from '@renaissance/core';

export interface UsageSample {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

interface DayRow {
  day: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export const dayOf = (d: Date): string => d.toISOString().slice(0, 10);
export const monthOf = (d: Date): string => d.toISOString().slice(0, 7);

export function usageStore(db: DatabaseSync) {
  const add = db.prepare(`
    INSERT INTO usage (profile, day, calls, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT (profile, day) DO UPDATE SET
      calls = calls + 1,
      input_tokens = input_tokens + excluded.input_tokens,
      output_tokens = output_tokens + excluded.output_tokens,
      cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
      cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens,
      cost_usd = cost_usd + excluded.cost_usd
  `);
  const monthHouse = db.prepare(
    'SELECT COALESCE(SUM(cost_usd), 0) AS spent FROM usage WHERE day LIKE ?',
  );
  const daysMine = db.prepare(`
    SELECT day, calls, input_tokens, output_tokens, cost_usd FROM usage
    WHERE profile = ? AND day LIKE ? ORDER BY day`);
  const daysHouse = db.prepare(`
    SELECT day, SUM(calls) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
      SUM(cost_usd) AS cost_usd FROM usage WHERE day LIKE ? GROUP BY day ORDER BY day`);
  return {
    record(profile: string, sample: UsageSample, now = new Date()): void {
      add.run(
        profile,
        dayOf(now),
        sample.inputTokens,
        sample.outputTokens,
        sample.cacheReadTokens,
        sample.cacheWriteTokens,
        sample.costUsd,
      );
    },
    /** The whole house's spend this month: the cap is per household (ADR 0007 point 6). */
    monthSpent(now = new Date()): number {
      return (monthHouse.get(`${monthOf(now)}%`) as unknown as { spent: number }).spent;
    },
    days(profile: string | 'house', now = new Date()): Budget['days'] {
      const like = `${monthOf(now)}%`;
      const rows = (profile === 'house'
        ? daysHouse.all(like)
        : daysMine.all(profile, like)) as unknown as DayRow[];
      return rows.map((r) => ({
        day: r.day,
        calls: r.calls,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        costUsd: r.cost_usd,
      }));
    },
  };
}
export type UsageStore = ReturnType<typeof usageStore>;
