/**
 * Integration test against a real (throwaway) Postgres database — see
 * `test-db.ts`. Exists specifically because the guarantee under test is a
 * property of the SQL `DrizzleSeatRepository.lockSeat` runs — `SELECT ...
 * FOR UPDATE` inside a transaction — not of any application-level logic. A
 * mocked-repository unit test (see `tests/unit/domain/seats/seat-lock.test.ts`)
 * can only assert that `SeatLockManager` interprets `{ locked: true|false }`
 * correctly; it structurally cannot exercise two real Postgres transactions
 * contending for one row, which is exactly what a mock removes. README.md
 * makes the "two people click the same seat, only one wins" claim publicly,
 * and until this file existed nothing could fail if that claim were false.
 */
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleSeatRepository } from '../../src/infrastructure/db/drizzle-seat.repository.js';
import * as schema from '../../src/infrastructure/db/schema/index.js';
import { createTestDatabase, insertTestPerformanceWithSeats, TEST_POOL_MAX, type TestDatabase } from './test-db.js';

const CONTENDERS = TEST_POOL_MAX;

describe('DrizzleSeatRepository.lockSeat', () => {
  let testDb: TestDatabase;
  let repository: DrizzleSeatRepository;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    repository = new DrizzleSeatRepository(testDb.db);

    // node-postgres opens physical connections lazily. Racing CONTENDERS
    // queries against a stone-cold pool means connection setup itself can
    // serialize the first race enough that the transactions never truly
    // overlap — verified empirically: with the row lock deliberately removed
    // (see the falsifiability check this file's header describes), the very
    // first scenario below passed anyway while later ones correctly caught
    // the regression, purely because the pool was still warming up. Forcing
    // all CONTENDERS connections into existence once, up front, means every
    // scenario races against an already-warm pool instead of the first one
    // alone absorbing (and hiding behind) that cost.
    await Promise.all(Array.from({ length: CONTENDERS }, () => testDb.db.execute(sql`select 1`)));
  }, 30000);

  afterAll(async () => {
    await testDb?.teardown();
  }, 30000);

  async function insertFixture(seats: Array<Partial<typeof schema.seatsTable.$inferInsert>>) {
    return insertTestPerformanceWithSeats(testDb.db, seats);
  }

  async function readSeat(seatId: string) {
    const [row] = await testDb.db.select().from(schema.seatsTable).where(eq(schema.seatsTable.id, seatId));
    return row;
  }

  it('lets exactly one of N contenders lock an available seat', async () => {
    const { seatIds } = await insertFixture([{ status: 'available' }]);
    const [seatId] = seatIds;

    const userIds = Array.from({ length: CONTENDERS }, () => randomUUID());
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const results = await Promise.all(userIds.map((userId) => repository.lockSeat(seatId, userId, expiresAt)));

    const winners = results.filter((r) => r.locked);
    expect(winners).toHaveLength(1);

    // Losing is not the same as not-found — the seat exists and every loser
    // should see it.
    for (const result of results.filter((r) => !r.locked)) {
      expect(result.seat).not.toBeNull();
    }

    // The return values alone can't catch "two callers both got
    // locked: true, second silently overwrote first" — only the database
    // re-read can, since the count-only assertion above would still look
    // green in that broken case (whichever result object happens to survive
    // in `results` said locked: true, but so might another).
    const winnerUserId = userIds[results.findIndex((r) => r.locked)];
    const seat = await readSeat(seatId);
    expect(seat.status).toBe('reserved');
    expect(seat.reservedBy).toBe(winnerUserId);
    expect(seat.reservedUntil).not.toBeNull();
  });

  it('lets exactly one fresh contender lock a seat whose hold just expired, not the stale holder', async () => {
    const staleHolder = randomUUID();
    const { seatIds } = await insertFixture([
      {
        status: 'reserved',
        reservedBy: staleHolder,
        reservedUntil: new Date(Date.now() - 60 * 1000), // expired a minute ago
      },
    ]);
    const [seatId] = seatIds;

    const userIds = Array.from({ length: CONTENDERS }, () => randomUUID());
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const results = await Promise.all(userIds.map((userId) => repository.lockSeat(seatId, userId, expiresAt)));

    const winners = results.filter((r) => r.locked);
    expect(winners).toHaveLength(1);

    const winnerUserId = userIds[results.findIndex((r) => r.locked)];
    const seat = await readSeat(seatId);
    expect(seat.status).toBe('reserved');
    expect(seat.reservedBy).toBe(winnerUserId);
    expect(seat.reservedBy).not.toBe(staleHolder);
  });

  it('grants the same user exactly one lock when racing themselves (current, deliberate behavior)', async () => {
    // isActiveReservation ignores ownership entirely — an active hold is
    // refused to everybody, including the user who already holds it. There
    // is no "same user retrying is a no-op" path today. This test pins that
    // down as current behavior; a future change making self-retry idempotent
    // would need to update this test consciously, not accidentally.
    const { seatIds } = await insertFixture([{ status: 'available' }]);
    const [seatId] = seatIds;
    const userId = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const results = await Promise.all(
      Array.from({ length: CONTENDERS }, () => repository.lockSeat(seatId, userId, expiresAt))
    );

    expect(results.filter((r) => r.locked)).toHaveLength(1);
    expect(results.filter((r) => !r.locked)).toHaveLength(CONTENDERS - 1);
  });

  it('never lets sold or blocked seats be locked under contention', async () => {
    const { seatIds } = await insertFixture([{ status: 'sold' }, { status: 'blocked' }]);
    const [soldSeatId, blockedSeatId] = seatIds;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    for (const seatId of [soldSeatId, blockedSeatId]) {
      const before = await readSeat(seatId);
      const userIds = Array.from({ length: CONTENDERS }, () => randomUUID());

      const results = await Promise.all(userIds.map((userId) => repository.lockSeat(seatId, userId, expiresAt)));

      expect(results.every((r) => !r.locked)).toBe(true);

      const after = await readSeat(seatId);
      expect(after.status).toBe(before.status);
      expect(after.reservedBy).toBe(before.reservedBy);
      expect(after.reservedUntil).toEqual(before.reservedUntil);
    }
  });
});
