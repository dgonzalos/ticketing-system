import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { usersTable } from './users.js';

/**
 * One row per successfully confirmed, successfully executed AI Admin
 * Assistant action — not per proposal, not per rejection, not per failed
 * confirmation. This is an accountability trail ("what did the assistant
 * actually change, and which admin approved it"), not a full interaction
 * log — the full conversation already lives in whatever IConversationStore
 * is configured.
 */
export const aiAdminActionsTable = pgTable('ai_admin_actions', {
  id: text('id').primaryKey(),
  adminUserId: text('admin_user_id')
    .notNull()
    .references(() => usersTable.id),
  conversationId: text('conversation_id').notNull(),
  tool: text('tool').notNull(),
  command: jsonb('command').notNull(),
  resultSummary: text('result_summary').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** An `ai_admin_actions` row as read from the database. */
export type AiAdminAction = typeof aiAdminActionsTable.$inferSelect;

/** Shape required to insert a new `ai_admin_actions` row. */
export type NewAiAdminAction = typeof aiAdminActionsTable.$inferInsert;
