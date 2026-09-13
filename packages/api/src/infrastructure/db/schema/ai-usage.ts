import { date, integer, numeric, pgTable, timestamp } from 'drizzle-orm/pg-core';

/**
 * One row per calendar day (UTC), accumulating Anthropic token usage and
 * estimated spend so `AiBudgetGuard` can cheaply check "how much have we
 * spent today" without scanning a call-level log table.
 *
 * `estimatedCostUsd` uses `mode: 'number'` rather than the default
 * `mode: 'string'` numeric mapping — unlike `orders.totalAmount` (integer
 * cents, an authoritative money ledger), this column is a *derived
 * estimate* feeding a soft budget gate: the token counters are the exact
 * source of truth, and a float here is an acceptable, deliberate trade-off
 * for a value nothing settles money against.
 *
 * Scale 6 (not the more obvious scale 4/$0.0001) deliberately resolves
 * below a single cheap call's cost: at this repo's own configured
 * `ANTHROPIC_INPUT_PRICE_PER_MTOK`, a small cache-read-heavy call can cost
 * a few hundredths of a cent, and Postgres rounds to the column's declared
 * scale *at insert time* — a scale too coarse would silently round such a
 * call's cost to exactly 0 before it ever reached the `excluded.*`
 * addition in `DrizzleUsageBudgetRepository.recordUsage`, permanently
 * losing it rather than merely deferring it.
 */
export const aiUsageDailyTable = pgTable('ai_usage_daily', {
  /** Calendar day (UTC) this row aggregates, e.g. '2026-09-12'. */
  date: date('date', { mode: 'string' }).primaryKey(),

  estimatedCostUsd: numeric('estimated_cost_usd', { precision: 12, scale: 6, mode: 'number' }).notNull().default(0),
  inputTokens: integer('input_tokens').notNull().default(0),
  cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),

  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** An `ai_usage_daily` row as read from the database. */
export type AiUsageDaily = typeof aiUsageDailyTable.$inferSelect;
