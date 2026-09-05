import { and, eq, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type {
  ISeatRepository,
  SeatConfirmResult,
  SeatDetails,
  SeatLock,
  SeatLockAttempt,
  SeatReleaseResult,
  SeatStatus,
} from '../../domain/seats/seat.repository.js';
import { isActiveReservation, markSeatsSold } from './seat-queries.js';
import * as schema from './schema/index.js';

type SeatRow = typeof schema.seatsTable.$inferSelect;

function toSeatLock(row: SeatRow): SeatLock {
  return {
    seatId: row.id,
    status: row.status as SeatStatus,
    reservedBy: row.reservedBy,
    reservedUntil: row.reservedUntil,
  };
}

function toSeatDetails(row: SeatRow): SeatDetails {
  return {
    seatId: row.id,
    performanceId: row.performanceId,
    row: row.row,
    number: row.number,
    zone: row.zone,
    price: row.price,
    status: row.status as SeatStatus,
    reservedBy: row.reservedBy,
    reservedUntil: row.reservedUntil,
  };
}

/**
 * Drizzle/PostgreSQL implementation of {@link ISeatRepository}. Uses
 * `SELECT ... FOR UPDATE` inside a transaction to guarantee that concurrent
 * lock attempts against the same seat are serialized at the database level.
 */
export class DrizzleSeatRepository implements ISeatRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async findById(seatId: string): Promise<SeatLock | null> {
    const rows = await this.db.select().from(schema.seatsTable).where(eq(schema.seatsTable.id, seatId));
    return rows[0] ? toSeatLock(rows[0]) : null;
  }

  async listByPerformance(performanceId: string): Promise<SeatDetails[]> {
    const rows = await this.db
      .select()
      .from(schema.seatsTable)
      .where(eq(schema.seatsTable.performanceId, performanceId));
    return rows.map(toSeatDetails);
  }

  async lockSeat(seatId: string, userId: string, expiresAt: Date): Promise<SeatLockAttempt> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const rows = await tx
        .select()
        .from(schema.seatsTable)
        .where(eq(schema.seatsTable.id, seatId))
        .for('update');

      const row = rows[0];
      if (!row) {
        return { locked: false, seat: null };
      }

      if (row.status === 'sold' || row.status === 'blocked' || isActiveReservation(row, now)) {
        return { locked: false, seat: toSeatLock(row) };
      }

      const [updated] = await tx
        .update(schema.seatsTable)
        .set({ status: 'reserved', reservedUntil: expiresAt, reservedBy: userId })
        .where(eq(schema.seatsTable.id, seatId))
        .returning();

      return { locked: true, seat: toSeatLock(updated) };
    });
  }

  async unlockSeat(seatId: string, userId: string): Promise<SeatReleaseResult> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.seatsTable)
        .where(eq(schema.seatsTable.id, seatId))
        .for('update');

      const row = rows[0];
      if (!row) {
        return { released: false, seat: null };
      }

      if (row.status !== 'reserved' || row.reservedBy !== userId) {
        return { released: false, seat: toSeatLock(row) };
      }

      const [updated] = await tx
        .update(schema.seatsTable)
        .set({ status: 'available', reservedUntil: null, reservedBy: null })
        .where(eq(schema.seatsTable.id, seatId))
        .returning();

      return { released: true, seat: toSeatLock(updated) };
    });
  }

  async confirmSeat(seatId: string, userId: string): Promise<SeatConfirmResult> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const rows = await tx
        .select()
        .from(schema.seatsTable)
        .where(eq(schema.seatsTable.id, seatId))
        .for('update');

      const row = rows[0];
      if (!row) {
        return { confirmed: false, seat: null };
      }

      if (row.reservedBy !== userId || !isActiveReservation(row, now)) {
        return { confirmed: false, seat: toSeatLock(row) };
      }

      const [updated] = await markSeatsSold(tx, [seatId]);

      return { confirmed: true, seat: toSeatLock(updated) };
    });
  }

  async cleanupExpiredLocks(now: Date): Promise<number> {
    const updated = await this.db
      .update(schema.seatsTable)
      .set({ status: 'available', reservedUntil: null, reservedBy: null })
      .where(and(eq(schema.seatsTable.status, 'reserved'), lt(schema.seatsTable.reservedUntil, now)))
      .returning({ id: schema.seatsTable.id });

    return updated.length;
  }
}
