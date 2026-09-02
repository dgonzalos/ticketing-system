import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeatLockOwnershipError, SeatNotFoundError } from '../../../../src/domain/common/errors/domain-errors.js';
import { SeatLockManager } from '../../../../src/domain/seats/seat-lock.js';
import type { ISeatRepository, SeatLock } from '../../../../src/domain/seats/seat.repository.js';

const LOCK_DURATION_MS = 5 * 60 * 1000;

function createMockRepository(): ISeatRepository {
  return {
    findById: vi.fn(),
    lockSeat: vi.fn(),
    unlockSeat: vi.fn(),
    confirmSeat: vi.fn(),
    cleanupExpiredLocks: vi.fn(),
  };
}

describe('SeatLockManager', () => {
  let repository: ISeatRepository;
  let manager: SeatLockManager;

  beforeEach(() => {
    repository = createMockRepository();
    manager = new SeatLockManager(repository);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('locks a seat successfully when it is available', async () => {
    /**
     * Straight-line success path: the repository reports the seat as
     * newly locked, so the manager should report success and hand back
     * the expiration it computed (not one echoed from the repository).
     */
    const now = new Date();
    const expectedExpiresAt = new Date(now.getTime() + LOCK_DURATION_MS);
    const lockedSeat: SeatLock = {
      seatId: 'seat-A12',
      status: 'reserved',
      reservedBy: 'user-1',
      reservedUntil: expectedExpiresAt,
    };
    (repository.lockSeat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      locked: true,
      seat: lockedSeat,
    });

    const result = await manager.lockSeat('seat-A12', 'user-1');

    expect(result).toEqual({ success: true, expiresAt: expectedExpiresAt });
    // Timeout behavior: the manager must request exactly a 5-minute hold,
    // not an approximate one.
    expect(repository.lockSeat).toHaveBeenCalledWith('seat-A12', 'user-1', expectedExpiresAt);
  });

  it('fails to lock a seat that is already reserved by someone else', async () => {
    /**
     * The repository reports the attempt as unsuccessful because another
     * user's reservation is still active. The manager must surface
     * success: false along with when that existing hold expires, rather
     * than the 5-minute window it originally requested.
     */
    const existingExpiry = new Date(Date.now() + 2 * 60 * 1000);
    const heldSeat: SeatLock = {
      seatId: 'seat-A12',
      status: 'reserved',
      reservedBy: 'user-2',
      reservedUntil: existingExpiry,
    };
    (repository.lockSeat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      locked: false,
      seat: heldSeat,
    });

    const result = await manager.lockSeat('seat-A12', 'user-1');

    expect(result).toEqual({ success: false, expiresAt: existingExpiry });
  });

  it('throws SeatNotFoundError when locking a seat that does not exist', async () => {
    /**
     * The repository reports no such row (seat: null), which is a
     * different failure mode than "already reserved" — the manager must
     * surface it as a thrown error, not a { success: false } result.
     */
    (repository.lockSeat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      locked: false,
      seat: null,
    });

    const error = await manager.lockSeat('seat-ghost', 'user-1').catch((e) => e);

    expect(error).toBeInstanceOf(SeatNotFoundError);
    expect((error as SeatNotFoundError).seatId).toBe('seat-ghost');
  });

  it('removes the reservation on unlock', async () => {
    /**
     * Owner-initiated release: the repository confirms the caller held
     * the lock and released it, so the manager resolves with no error.
     */
    const availableSeat: SeatLock = {
      seatId: 'seat-A12',
      status: 'available',
      reservedBy: null,
      reservedUntil: null,
    };
    (repository.unlockSeat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      released: true,
      seat: availableSeat,
    });

    await expect(manager.unlockSeat('seat-A12', 'user-1')).resolves.toBeUndefined();
    expect(repository.unlockSeat).toHaveBeenCalledWith('seat-A12', 'user-1');
  });

  it('throws SeatNotFoundError when unlocking a seat that does not exist', async () => {
    (repository.unlockSeat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      released: false,
      seat: null,
    });

    const error = await manager.unlockSeat('seat-ghost', 'user-1').catch((e) => e);

    expect(error).toBeInstanceOf(SeatNotFoundError);
    expect((error as SeatNotFoundError).seatId).toBe('seat-ghost');
  });

  it('throws SeatLockOwnershipError when unlocking a seat held by someone else', async () => {
    /**
     * The seat exists but the repository refused to release it — the
     * caller either never held the lock or it was already reassigned.
     * The manager must not treat this as a silent no-op.
     */
    const heldByOther: SeatLock = {
      seatId: 'seat-A12',
      status: 'reserved',
      reservedBy: 'user-2',
      reservedUntil: new Date(Date.now() + 60 * 1000),
    };
    (repository.unlockSeat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      released: false,
      seat: heldByOther,
    });

    const error = await manager.unlockSeat('seat-A12', 'user-1').catch((e) => e);

    expect(error).toBeInstanceOf(SeatLockOwnershipError);
    expect((error as SeatLockOwnershipError).seatId).toBe('seat-A12');
    expect((error as SeatLockOwnershipError).userId).toBe('user-1');
  });

  it('converts a reserved seat to sold on confirm', async () => {
    /**
     * Checkout completes: the repository confirms the reservation
     * belonged to the caller and converted it to a sale.
     */
    const soldSeat: SeatLock = {
      seatId: 'seat-A12',
      status: 'sold',
      reservedBy: null,
      reservedUntil: null,
    };
    (repository.confirmSeat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      confirmed: true,
      seat: soldSeat,
    });

    await expect(manager.confirmSeat('seat-A12', 'user-1')).resolves.toBeUndefined();
    expect(repository.confirmSeat).toHaveBeenCalledWith('seat-A12', 'user-1');
  });

  it('throws SeatNotFoundError when confirming a seat that does not exist', async () => {
    (repository.confirmSeat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      confirmed: false,
      seat: null,
    });

    const error = await manager.confirmSeat('seat-ghost', 'user-1').catch((e) => e);

    expect(error).toBeInstanceOf(SeatNotFoundError);
    expect((error as SeatNotFoundError).seatId).toBe('seat-ghost');
  });

  it('throws SeatLockOwnershipError when confirming a seat held by someone else or expired', async () => {
    /**
     * The seat exists but the repository refused to convert it to a sale
     * — either the reservation belongs to a different user, or it has
     * already expired. Either way, checkout must fail loudly, not
     * silently mark someone else's seat as sold.
     */
    const heldByOther: SeatLock = {
      seatId: 'seat-A12',
      status: 'reserved',
      reservedBy: 'user-2',
      reservedUntil: new Date(Date.now() + 60 * 1000),
    };
    (repository.confirmSeat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      confirmed: false,
      seat: heldByOther,
    });

    const error = await manager.confirmSeat('seat-A12', 'user-1').catch((e) => e);

    expect(error).toBeInstanceOf(SeatLockOwnershipError);
    expect((error as SeatLockOwnershipError).seatId).toBe('seat-A12');
    expect((error as SeatLockOwnershipError).userId).toBe('user-1');
  });

  it('cleans up expired locks and returns the count removed', async () => {
    /**
     * Background-job path: the manager just delegates to the repository
     * with the current time and passes the count straight through.
     */
    (repository.cleanupExpiredLocks as ReturnType<typeof vi.fn>).mockResolvedValueOnce(3);

    const count = await manager.cleanupExpiredLocks();

    expect(count).toBe(3);
    expect(repository.cleanupExpiredLocks).toHaveBeenCalledWith(new Date());
  });

  it('lets exactly one of two concurrent lockSeat attempts for the same seat win', async () => {
    /**
     * RACE CONDITION SCENARIO
     * ------------------------
     * Two users both try to lock seat-A12 at the same instant (imagine
     * two HTTP requests hitting the server together). A real repository
     * guarantees only one can succeed via `SELECT ... FOR UPDATE` inside a
     * transaction, serializing the two attempts at the database.
     *
     * This test can't spin up Postgres, so `lockSeat` is given a stateful
     * mock implementation that performs the same "check, then set" logic
     * a real transaction would — critically, with no `await` between the
     * check and the write. Because JS async functions run synchronously
     * up to their first `await`, each call's check-and-set body runs to
     * completion in a single microtask turn before the other call's body
     * can interleave with it, so "first caller wins" naturally holds even
     * without a real lock.
     *
     * This proves SeatLockManager correctly reports exactly one winner
     * when given a repository that serializes correctly. It does NOT
     * prove DrizzleSeatRepository's real SELECT FOR UPDATE actually
     * serializes at the Postgres level — that requires a separate
     * integration test against a real database.
     */
    let heldBy: string | null = null;
    let reservedUntil: Date | null = null;

    (repository.lockSeat as ReturnType<typeof vi.fn>).mockImplementation(
      async (seatId: string, userId: string, expiresAt: Date) => {
        const now = new Date();
        const isAvailable = heldBy === null || (reservedUntil !== null && reservedUntil < now);

        if (!isAvailable) {
          return {
            locked: false,
            seat: { seatId, status: 'reserved', reservedBy: heldBy, reservedUntil },
          };
        }

        heldBy = userId;
        reservedUntil = expiresAt;
        return {
          locked: true,
          seat: { seatId, status: 'reserved', reservedBy: userId, reservedUntil: expiresAt },
        };
      }
    );

    const [resultA, resultB] = await Promise.all([
      manager.lockSeat('seat-A12', 'user-1'),
      manager.lockSeat('seat-A12', 'user-2'),
    ]);

    const successes = [resultA, resultB].filter((r) => r.success);
    const failures = [resultA, resultB].filter((r) => !r.success);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    // The loser is told when the winner's hold expires.
    expect(failures[0]?.expiresAt).toEqual(successes[0]?.expiresAt);
  });
});
