import { SeatLockOwnershipError, SeatNotFoundError } from '../common/errors/domain-errors.js';
import type { ISeatRepository, SeatDetails } from './seat.repository.js';

export type { SeatDetails, SeatLock, SeatStatus } from './seat.repository.js';

/** Whether `seat`'s reservation is still `reserved` and has not passed its `reservedUntil`. */
function isActivelyReserved(seat: { status: SeatDetails['status']; reservedUntil: Date | null }, now: Date): boolean {
  return seat.status === 'reserved' && seat.reservedUntil !== null && seat.reservedUntil >= now;
}

/**
 * Orchestrates temporary seat reservations to prevent double-booking.
 *
 * Pure business logic: it knows the lock duration and the rules for who may
 * unlock/confirm a seat, but delegates all persistence and atomicity
 * guarantees to the injected {@link ISeatRepository}. This class has no
 * knowledge of the database, ORM, or web framework in use.
 */
export class SeatLockManager {
  private static readonly LOCK_DURATION_MS = 5 * 60 * 1000;

  constructor(private readonly repository: ISeatRepository) {}

  /**
   * Attempts to reserve a seat for `userId` for 5 minutes.
   *
   * @returns `success: true` with the new expiration if the reservation was
   * acquired; `success: false` with the expiration of the existing
   * reservation (so the caller knows when it may next become available) if
   * the seat is already held by someone else.
   * @throws {SeatNotFoundError} if the seat does not exist.
   */
  async lockSeat(seatId: string, userId: string): Promise<{ success: boolean; expiresAt: Date }> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SeatLockManager.LOCK_DURATION_MS);

    const attempt = await this.repository.lockSeat(seatId, userId, expiresAt);

    if (!attempt.seat) {
      throw new SeatNotFoundError(seatId);
    }

    if (!attempt.locked) {
      return { success: false, expiresAt: attempt.seat.reservedUntil ?? now };
    }

    return { success: true, expiresAt };
  }

  /**
   * Releases a reservation held by `userId`, returning the seat to
   * `available`.
   *
   * @throws {SeatNotFoundError} if the seat does not exist.
   * @throws {SeatLockOwnershipError} if `userId` does not currently hold the
   * reservation.
   */
  async unlockSeat(seatId: string, userId: string): Promise<void> {
    const result = await this.repository.unlockSeat(seatId, userId);

    if (!result.seat) {
      throw new SeatNotFoundError(seatId);
    }

    if (!result.released) {
      throw new SeatLockOwnershipError(seatId, userId);
    }
  }

  /**
   * Converts a reservation held by `userId` into a sale.
   *
   * @throws {SeatNotFoundError} if the seat does not exist.
   * @throws {SeatLockOwnershipError} if the reservation is not currently
   * held by `userId`, or has expired.
   */
  async confirmSeat(seatId: string, userId: string): Promise<void> {
    const result = await this.repository.confirmSeat(seatId, userId);

    if (!result.seat) {
      throw new SeatNotFoundError(seatId);
    }

    if (!result.confirmed) {
      throw new SeatLockOwnershipError(seatId, userId);
    }
  }

  /**
   * Releases every expired reservation back to `available`. Intended to be
   * invoked periodically by a background job.
   *
   * @returns the number of seats that were cleaned up.
   */
  async cleanupExpiredLocks(): Promise<number> {
    return this.repository.cleanupExpiredLocks(new Date());
  }

  /**
   * Lists every seat belonging to `performanceId`, for rendering a seat map.
   *
   * A seat whose hold has passed `reservedUntil` but hasn't since been
   * touched by `lockSeat`/`confirmSeat`/`cleanupExpiredLocks` is presented
   * as `available` here (status, `reservedBy`, and `reservedUntil` all
   * reset in the returned value, not written back to storage) — matching
   * what `checkAvailability`/`lockSeat` would actually allow, so the seat
   * map doesn't show a seat as taken when a caller could lock it right now.
   */
  async listSeats(performanceId: string): Promise<SeatDetails[]> {
    const seats = await this.repository.listByPerformance(performanceId);
    const now = new Date();
    return seats.map((seat) =>
      seat.status === 'reserved' && !isActivelyReserved(seat, now)
        ? { ...seat, status: 'available', reservedBy: null, reservedUntil: null }
        : seat
    );
  }

  /**
   * Checks whether each of `seatIds` is currently available to lock — either
   * genuinely `available`, or `reserved` with an expired hold. Seats that do
   * not exist are reported as unavailable, not thrown.
   */
  async checkAvailability(seatIds: string[]): Promise<Record<string, boolean>> {
    const now = new Date();
    const entries = await Promise.all(
      seatIds.map(async (seatId): Promise<[string, boolean]> => {
        const seat = await this.repository.findById(seatId);
        const available = seat !== null && (seat.status === 'available' || (seat.status === 'reserved' && !isActivelyReserved(seat, now)));
        return [seatId, available];
      })
    );
    return Object.fromEntries(entries);
  }
}
