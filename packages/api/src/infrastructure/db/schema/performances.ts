import { date, index, integer, pgTable, text, time, timestamp } from 'drizzle-orm/pg-core';
import { eventsTable } from './events.js';

/**
 * A single scheduled instance of an event: a specific date/time at a
 * specific venue. Seats (see `seats.ts`) belong to a performance, not
 * directly to an event — the same event can be staged many times, each
 * with its own independent seat map.
 */
export const performancesTable = pgTable(
  'performances',
  {
    /** Stable performance identifier, e.g. `'perf-1'`. Not a surrogate key. */
    id: text('id').primaryKey(),

    /** The event this performance stages. */
    eventId: text('event_id')
      .notNull()
      .references(() => eventsTable.id),

    /** Calendar date of the performance, e.g. `'2026-03-14'`. */
    date: date('date').notNull(),

    /** Start time of day, e.g. `'19:30:00'`. */
    time: time('time').notNull(),

    /** Venue name, e.g. `'Orpheum Theatre'`. */
    venue: text('venue').notNull(),

    /** City the venue is in, e.g. `'Seattle'`. */
    city: text('city').notNull(),

    /**
     * Total seat count for this performance, for display purposes (e.g. "100
     * seats"). Informational only — not recomputed from the `seats` table,
     * so it can drift if seats are added/removed after seeding.
     */
    capacity: integer('capacity').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    eventIdIdx: index('performances_event_id_idx').on(table.eventId),
    dateIdx: index('performances_date_idx').on(table.date),
  })
);

/** A performance row as read from the database. */
export type Performance = typeof performancesTable.$inferSelect;

/** Shape required to insert a new performance row. */
export type NewPerformance = typeof performancesTable.$inferInsert;
