/** A single call's token usage and estimated cost, to be persisted atomically. */
export interface UsageIncrement {
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Framework-agnostic persistence contract for daily AI spend tracking. The
 * domain layer depends on this interface only — it must not import
 * Drizzle or any database driver.
 */
export interface IUsageBudgetRepository {
  /** Total estimated USD spent today (server's current UTC date). */
  getTodaySpendUsd(): Promise<number>;

  /**
   * Atomically adds `increment`'s counters and cost onto today's row,
   * creating it if it doesn't exist yet. Must be a single upsert
   * statement, not a read-then-write, so concurrent calls can't lose
   * updates — see `DrizzleUsageBudgetRepository.recordUsage`.
   */
  recordUsage(increment: UsageIncrement): Promise<void>;
}
