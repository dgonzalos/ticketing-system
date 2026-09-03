/** Lifecycle state of a seat. */
export type SeatStatus = 'available' | 'reserved' | 'sold' | 'blocked';

/** Current lock/ownership state of a seat, as seen by the domain layer. */
export interface SeatLock {
  seatId: string;
  status: SeatStatus;
  reservedBy: string | null;
  reservedUntil: Date | null;
}

/** Full seat record for display purposes (e.g. rendering a seat map). */
export interface SeatDetails {
  seatId: string;
  performanceId: string;
  row: string;
  number: number;
  zone: string;
  /** Price in cents. */
  price: number;
  status: SeatStatus;
  reservedBy: string | null;
  reservedUntil: Date | null;
}

/** Result of attempting to reserve a seat. */
export interface SeatLockAttempt {
  locked: boolean;
  /** Current state of the seat after the attempt; null if the seat does not exist. */
  seat: SeatLock | null;
}

/** Result of attempting to release a reservation. */
export interface SeatReleaseResult {
  released: boolean;
  /** Current state of the seat after the attempt; null if the seat does not exist. */
  seat: SeatLock | null;
}

/** Result of attempting to convert a reservation into a sale. */
export interface SeatConfirmResult {
  confirmed: boolean;
  /** Current state of the seat after the attempt; null if the seat does not exist. */
  seat: SeatLock | null;
}

/**
 * Framework-agnostic persistence contract for seat locking.
 *
 * Implementations are responsible for atomicity (e.g. via `SELECT ... FOR
 * UPDATE` inside a transaction) so that concurrent callers racing for the
 * same seat cannot both succeed. The domain layer depends on this interface
 * only — it must not import a specific database driver or ORM.
 */
export interface ISeatRepository {
  /** Reads the current state of a seat, or null if it does not exist. */
  findById(seatId: string): Promise<SeatLock | null>;

  /** Reads every seat belonging to `performanceId`, for rendering a seat map. */
  listByPerformance(performanceId: string): Promise<SeatDetails[]>;

  /**
   * Atomically reserves a seat for `userId` until `expiresAt`, iff the seat
   * exists and is either `available` or `reserved` with an expired
   * `reservedUntil`. Must use a row-level lock so concurrent callers cannot
   * both succeed for the same seat.
   */
  lockSeat(seatId: string, userId: string, expiresAt: Date): Promise<SeatLockAttempt>;

  /** Releases a reservation, but only if it is currently held by `userId`. */
  unlockSeat(seatId: string, userId: string): Promise<SeatReleaseResult>;

  /**
   * Converts a `reserved` seat into `sold`, but only if the reservation is
   * currently held by `userId` (and has not expired).
   */
  confirmSeat(seatId: string, userId: string): Promise<SeatConfirmResult>;

  /**
   * Resets every seat whose reservation has expired as of `now` back to
   * `available`. Returns the number of seats changed.
   */
  cleanupExpiredLocks(now: Date): Promise<number>;
}
