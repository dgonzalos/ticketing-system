import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * A show/production that can have one or more scheduled performances (see
 * `performances.ts`), e.g. "Hamilton" as an event with several dates across
 * several venues.
 */
export const eventsTable = pgTable('events', {
  /** Stable event identifier, e.g. `'event-1'`. Not a surrogate key. */
  id: text('id').primaryKey(),

  /** Display name, e.g. `'Hamilton'`. */
  title: text('title').notNull(),

  /** Longer-form description shown on the event's detail view. */
  description: text('description'),

  /** Cover/promo image URL, if any. */
  imageUrl: text('image_url'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** An event row as read from the database. */
export type Event = typeof eventsTable.$inferSelect;

/** Shape required to insert a new event row. */
export type NewEvent = typeof eventsTable.$inferInsert;
