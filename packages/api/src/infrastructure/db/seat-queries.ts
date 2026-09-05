import { inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index.js';

/** The transaction handle type produced by `db.transaction(async (tx) => ...)`. */
export type DbTransaction = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

export type SeatRow = typeof schema.seatsTable.$inferSelect;

/**
 * Whether `seat`'s reservation is still `reserved` and has not passed its
 * `reservedUntil`. Shared by `DrizzleSeatRepository` and
 * `DrizzleOrderRepository` so both agree on the same answer for the same
 * row — in particular, a `'reserved'` row with a null `reservedUntil`
 * (which the `seats_reservation_pair_check` DB constraint should make
 * unreachable, since `reservedBy`/`reservedUntil` are always written
 * together) is treated as still active here, not silently expired.
 */
export function isActiveReservation(seat: SeatRow, now: Date): boolean {
  const expired = seat.reservedUntil !== null && seat.reservedUntil < now;
  return seat.status === 'reserved' && !expired;
}

/**
 * Locks the given seats for update within `tx`, so no other transaction can
 * read/modify them until `tx` commits or rolls back. Shared by
 * `DrizzleSeatRepository` (single-seat operations) and
 * `DrizzleOrderRepository` (multi-seat atomic checkout) so the row-locking
 * SQL shape has one source of truth.
 *
 * Returns whatever rows actually match `seatIds` — callers must check the
 * count/contents themselves (a missing id just isn't in the result).
 */
export async function lockSeatsForUpdate(tx: DbTransaction, seatIds: string[]): Promise<SeatRow[]> {
  return tx.select().from(schema.seatsTable).where(inArray(schema.seatsTable.id, seatIds)).for('update');
}

/**
 * Marks the given seats `sold` and clears their reservation, within `tx`.
 * Callers are responsible for having already verified (under the lock from
 * {@link lockSeatsForUpdate}) that every seat is eligible to be sold.
 */
export async function markSeatsSold(tx: DbTransaction, seatIds: string[]): Promise<SeatRow[]> {
  return tx
    .update(schema.seatsTable)
    .set({ status: 'sold', reservedUntil: null, reservedBy: null })
    .where(inArray(schema.seatsTable.id, seatIds))
    .returning();
}
