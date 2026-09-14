/** One successfully executed AI Admin Assistant action, ready to persist. */
export interface AiActionLogEntry {
  adminUserId: string;
  conversationId: string;
  tool: string;
  command: unknown;
  resultSummary: string;
}

/**
 * Framework-agnostic persistence contract for the AI Admin Assistant's
 * accountability trail. The domain layer depends on this interface only —
 * it must not import Drizzle or any database driver.
 *
 * Append-only by design: only `record` exists, because nothing in this
 * feature ever needs to update or delete an audit row.
 */
export interface IAiActionLogRepository {
  record(entry: AiActionLogEntry): Promise<void>;
}
