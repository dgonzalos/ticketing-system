import { decimal, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * A single bookable seat for a performance.
 *
 * `status`/`reservedUntil`/`reservedBy` implement the temporal-lock pattern
 * used to prevent double-booking (see docs/1-seat-concurrency-deep-dive.md):
 * a seat moves `available` -> `reserved` (with an expiration) -> `sold`, and
 * an expired `reserved` seat is treated as `available` again.
 */
export const seatsTable = pgTable(
  'seats',
  {
    id: text('id').primaryKey(),
    performanceId: text('performance_id').notNull(),
    row: text('row').notNull(),
    number: integer('number').notNull(),
    price: decimal('price', { precision: 10, scale: 2 }).notNull(),

    /** 'available' | 'reserved' | 'sold' | 'blocked' */
    status: text('status').default('available').notNull(),

    /** When the current reservation expires; null if not reserved. */
    reservedUntil: timestamp('reserved_until', { withTimezone: true }),

    /** User holding the current reservation; null if not reserved. */
    reservedBy: text('reserved_by'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    reservedUntilIdx: index('seats_reserved_until_idx').on(table.reservedUntil),
  })
);
