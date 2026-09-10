import { sql } from 'drizzle-orm';
import { date, index, integer, pgEnum, pgTable, text, time, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { eventsTable } from './events.js';

/**
 * Lifecycle state of a performance. `cancelled` is a status flip, never a
 * delete — performances are referenced by seats, and through them by
 * order_items, so deleting one would either violate a foreign key or
 * destroy purchase history. See `EventAdminService.cancelPerformance`.
 */
export const performanceStatusEnum = pgEnum('performance_status', ['scheduled', 'cancelled']);

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

    /** Lifecycle state — see `performanceStatusEnum` doc above. */
    status: performanceStatusEnum('status').default('scheduled').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    eventIdIdx: index('performances_event_id_idx').on(table.eventId),
    dateIdx: index('performances_date_idx').on(table.date),

    /**
     * Enforces "no two scheduled performances for the same event at the
     * same date/time/venue" at the database level — a partial index
     * (`WHERE status = 'scheduled'`) so a cancelled performance never
     * blocks re-scheduling the same slot. This is the actual source of
     * truth for that invariant: `EventAdminService.createPerformances`'s
     * own pre-check (`findScheduledPerformance` + an in-memory batch scan)
     * is only a fast-path UX nicety for the common, non-concurrent case —
     * a pre-check read alone can't stop two concurrent identical requests
     * from both passing it before either commits. See
     * `DrizzleUserRepository.create`'s `users_email_unique` handling for
     * the same pattern applied to email uniqueness.
     */
    scheduledSlotUniqueIdx: uniqueIndex('performances_scheduled_slot_unique')
      .on(table.eventId, table.date, table.time, table.venue)
      .where(sql`${table.status} = 'scheduled'`),
  })
);

/** A performance row as read from the database. */
export type Performance = typeof performancesTable.$inferSelect;

/** Shape required to insert a new performance row. */
export type NewPerformance = typeof performancesTable.$inferInsert;

/** The set of valid `status` values. */
export type PerformanceStatus = (typeof performanceStatusEnum.enumValues)[number];
