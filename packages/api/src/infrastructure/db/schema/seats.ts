import { sql } from 'drizzle-orm';
import { check, index, integer, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Lifecycle state of a seat.
 *
 * `available` -> `reserved` (temporary hold, see `reservedUntil`) -> `sold`.
 * `blocked` is a separate terminal state for seats withheld from sale
 * (e.g. house seats, accessibility holds) and is never reached via the
 * reservation flow.
 */
export const seatStatusEnum  = pgEnum('seat_status', ['available', 'reserved', 'sold', 'blocked']);

/**
 * A single bookable seat for a performance.
 *
 * ## Reservation pattern
 *
 * `status`/`reservedBy`/`reservedUntil` implement the temporal-lock pattern
 * used to prevent double-booking (see docs/1-seat-concurrency-deep-dive.md):
 *
 * 1. A seat starts `available`, with `reservedBy`/`reservedUntil` both null.
 * 2. Locking the seat sets `status` to `reserved` and stamps `reservedBy`
 *    (the locking user) and `reservedUntil` (an expiration a few minutes
 *    out) together, in the same write.
 * 3. If the reservation is confirmed before it expires, `status` becomes
 *    `sold` and `reservedBy`/`reservedUntil` are cleared back to null.
 * 4. If the reservation is released, or a background sweep finds
 *    `reservedUntil` in the past, `status` reverts to `available` and
 *    `reservedBy`/`reservedUntil` are cleared back to null.
 *
 * `reservedBy` and `reservedUntil` are therefore always set or cleared as a
 * pair — the `seats_reservation_pair_check` constraint enforces this at the
 * database level so a half-written reservation (e.g. an owner with no
 * expiration) can never be persisted, even by a bug elsewhere in the app.
 * Row-level locking for the concurrent "two users grab the same seat" race
 * is the repository layer's job (`SELECT ... FOR UPDATE`), not this schema's.
 */
export const seatsTable = pgTable(
  'seats',
  {
    /** Stable seat identifier, e.g. `'seat-A12'`. Not a surrogate key. */
    id: text('id').primaryKey(),

    /**
     * The performance this seat belongs to. Will become a foreign key once
     * the `performances` table exists; stored as plain text for now.
     */
    performanceId: text('performance_id').notNull(),

    /** Row label within the venue, e.g. `'A'`, `'B'`. */
    row: text('row').notNull(),

    /** Seat number within the row, e.g. `1`, `2`, `3`. */
    number: integer('number').notNull(),

    /** Pricing tier, e.g. `'premium'`, `'standard'`, `'economy'`. */
    zone: text('zone').notNull(),

    /** Price in cents (e.g. `5000` = $50.00), to avoid floating-point rounding. */
    price: integer('price').notNull(),

    /** Current lifecycle state — see the reservation pattern above. */
    status: seatStatusEnum('status').default('available').notNull(),

    /** User currently holding the reservation; null iff `reservedUntil` is null. */
    reservedBy: text('reserved_by'),

    /** When the current reservation expires; null iff `reservedBy` is null. */
    reservedUntil: timestamp('reserved_until', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

    /**
     * Last-modified timestamp. Not auto-bumped by the ORM (drizzle-orm 0.29
     * predates `$onUpdate`) — callers must set it explicitly on every write
     * that changes a seat.
     */
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    performanceIdIdx: index('seats_performance_id_idx').on(table.performanceId),
    statusIdx: index('seats_status_idx').on(table.status),
    reservedUntilIdx: index('seats_reserved_until_idx').on(table.reservedUntil),

    /** `reservedBy`/`reservedUntil` must be set or cleared together — see class doc. */
    reservationPairCheck: check(
      'seats_reservation_pair_check',
      sql`(${table.reservedBy} IS NULL AND ${table.reservedUntil} IS NULL) OR (${table.reservedBy} IS NOT NULL AND ${table.reservedUntil} IS NOT NULL)`
    ),
  })
);

/** A seat row as read from the database. */
export type Seat = typeof seatsTable.$inferSelect;

/** Shape required to insert a new seat row. */
export type NewSeat = typeof seatsTable.$inferInsert;

/** The set of valid `status` values. */
export type SeatStatus = (typeof seatStatusEnum.enumValues)[number];
