import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { IUsageBudgetRepository, UsageIncrement } from '../../domain/ai/usage-budget.repository.js';
import * as schema from './schema/index.js';

/** Returns today's date as 'YYYY-MM-DD' in UTC, matching the primary key format. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Drizzle/PostgreSQL implementation of {@link IUsageBudgetRepository}.
 *
 * `recordUsage` is a single `INSERT ... ON CONFLICT (date) DO UPDATE`
 * statement, not a read-then-write from application code — unlike
 * `DrizzleOrderRepository.updateOrderStatus`'s guarded
 * `WHERE status = fromStatus` (which rejects a stale write outright),
 * concurrent AI calls landing on the same day must both *succeed* and
 * *add up correctly*, so the increment itself has to happen atomically in
 * the database via `excluded.<column>` arithmetic, not a check-then-set.
 * This is the first `onConflictDoUpdate` in this codebase.
 */
export class DrizzleUsageBudgetRepository implements IUsageBudgetRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async getTodaySpendUsd(): Promise<number> {
    const [row] = await this.db
      .select({ estimatedCostUsd: schema.aiUsageDailyTable.estimatedCostUsd })
      .from(schema.aiUsageDailyTable)
      .where(eq(schema.aiUsageDailyTable.date, todayUtc()));

    return row?.estimatedCostUsd ?? 0;
  }

  async recordUsage(increment: UsageIncrement): Promise<void> {
    await this.db
      .insert(schema.aiUsageDailyTable)
      .values({
        date: todayUtc(),
        estimatedCostUsd: increment.costUsd,
        inputTokens: increment.inputTokens,
        cacheWriteTokens: increment.cacheWriteTokens,
        cacheReadTokens: increment.cacheReadTokens,
        outputTokens: increment.outputTokens,
      })
      .onConflictDoUpdate({
        target: schema.aiUsageDailyTable.date,
        set: {
          estimatedCostUsd: sql`${schema.aiUsageDailyTable.estimatedCostUsd} + excluded.estimated_cost_usd`,
          inputTokens: sql`${schema.aiUsageDailyTable.inputTokens} + excluded.input_tokens`,
          cacheWriteTokens: sql`${schema.aiUsageDailyTable.cacheWriteTokens} + excluded.cache_write_tokens`,
          cacheReadTokens: sql`${schema.aiUsageDailyTable.cacheReadTokens} + excluded.cache_read_tokens`,
          outputTokens: sql`${schema.aiUsageDailyTable.outputTokens} + excluded.output_tokens`,
          updatedAt: new Date(),
        },
      });
  }
}
