import { SeatLockOwnershipError, SeatNotFoundError } from '../common/errors/domain-errors.js';
import type { ISeatRepository } from './seat.repository.js';

export type { SeatLock, SeatStatus } from './seat.repository.js';

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
}
