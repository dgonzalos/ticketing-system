/**
 * Integration test against a real (throwaway) Postgres database — see
 * `test-db.ts`. `DrizzleOrderRepository.listOrderSummariesByUser` is one
 * SQL aggregate (joins, `array_agg ... ORDER BY`, text-formatted date/time,
 * a per-user `WHERE`), so a mocked-repository test can't show it's right:
 * only a real database can catch another user's order leaking in, or seat
 * labels sorting as text ("A10" before "A2").
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleOrderRepository } from '../../src/infrastructure/db/drizzle-order.repository.js';
import * as schema from '../../src/infrastructure/db/schema/index.js';
import { createTestDatabase, insertTestPerformanceWithSeats, type TestDatabase } from './test-db.js';

type OrderStatus = 'pending' | 'payment_processing' | 'completed' | 'cancelled';

describe('DrizzleOrderRepository.listOrderSummariesByUser', () => {
  let testDb: TestDatabase;
  let repository: DrizzleOrderRepository;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    repository = new DrizzleOrderRepository(testDb.db);
  }, 30000);

  afterAll(async () => {
    await testDb?.teardown();
  }, 30000);

  /** Inserts an order (and its items) directly, with a chosen creation time — bypassing checkout's seat locking, which isn't under test here. */
  async function insertOrder(
    userId: string,
    performanceId: string,
    seatIds: string[],
    { status = 'completed', createdAt }: { status?: OrderStatus; createdAt: Date }
  ): Promise<string> {
    const orderId = randomUUID();
    await testDb.db.insert(schema.ordersTable).values({
      id: orderId,
      userId,
      email: `${userId}@example.com`,
      performanceId,
      status,
      totalAmount: 1000 * seatIds.length,
      createdAt,
    });
    await testDb.db.insert(schema.orderItemsTable).values(seatIds.map((seatId) => ({ orderId, seatId, price: 1000 })));
    return orderId;
  }

  it("returns only the caller's orders, newest first, with event, performance, and seats", async () => {
    const buyer = randomUUID();
    const otherBuyer = randomUUID();
    const { eventId, performanceId, seatIds } = await insertTestPerformanceWithSeats(
      testDb.db,
      [
        { row: 'B', number: 10, status: 'sold' },
        { row: 'A', number: 2, status: 'sold' },
        { row: 'A', number: 10, status: 'sold' },
        { row: 'C', number: 1, status: 'sold' },
        { row: 'C', number: 2, status: 'sold' },
      ],
      { date: '2026-10-16', time: '19:30:00', venue: 'Teatro Alameda', city: 'Madrid' }
    );

    const older = await insertOrder(buyer, performanceId, [seatIds[3]], { createdAt: new Date('2026-10-01T10:00:00Z') });
    const newer = await insertOrder(buyer, performanceId, [seatIds[0], seatIds[1], seatIds[2]], {
      status: 'pending',
      createdAt: new Date('2026-10-02T10:00:00Z'),
    });
    await insertOrder(otherBuyer, performanceId, [seatIds[4]], { createdAt: new Date('2026-10-03T10:00:00Z') });

    const summaries = await repository.listOrderSummariesByUser(buyer);

    expect(summaries.map((s) => s.orderId)).toEqual([newer, older]);
    expect(summaries[0]).toMatchObject({
      status: 'pending',
      totalAmount: 3000,
      // Row, then seat number numerically — not text order, which would put A10 before A2.
      seatLabels: ['A2', 'A10', 'B10'],
      event: { eventId, title: 'Integration Test Event' },
      performance: { performanceId, date: '2026-10-16', time: '19:30:00', venue: 'Teatro Alameda', city: 'Madrid' },
    });
    expect(summaries[0].createdAt).toBeInstanceOf(Date);
    expect(typeof summaries[0].performance.date).toBe('string');
  });

  it('still lists an expired (cancelled) order', async () => {
    const buyer = randomUUID();
    const { performanceId, seatIds } = await insertTestPerformanceWithSeats(testDb.db, [{ status: 'available' }]);
    const orderId = await insertOrder(buyer, performanceId, seatIds, {
      status: 'cancelled',
      createdAt: new Date('2026-10-01T10:00:00Z'),
    });

    const summaries = await repository.listOrderSummariesByUser(buyer);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ orderId, status: 'cancelled', seatLabels: ['A1'] });
  });

  it('returns an empty list for a user with no orders', async () => {
    await expect(repository.listOrderSummariesByUser(randomUUID())).resolves.toEqual([]);
  });
});
