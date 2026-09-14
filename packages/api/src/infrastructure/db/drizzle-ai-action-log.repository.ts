import { randomUUID } from 'node:crypto';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { AiActionLogEntry, IAiActionLogRepository } from '../../domain/ai/ai-action-log.repository.js';
import * as schema from './schema/index.js';

/** Drizzle/PostgreSQL implementation of {@link IAiActionLogRepository} — a single, append-only insert. */
export class DrizzleAiActionLogRepository implements IAiActionLogRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async record(entry: AiActionLogEntry): Promise<void> {
    await this.db.insert(schema.aiAdminActionsTable).values({
      id: randomUUID(),
      adminUserId: entry.adminUserId,
      conversationId: entry.conversationId,
      tool: entry.tool,
      command: entry.command,
      resultSummary: entry.resultSummary,
    });
  }
}
