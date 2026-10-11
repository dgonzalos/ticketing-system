/**
 * Integration test against a real (throwaway) Postgres database — see
 * `test-db.ts`. `DrizzleAnalyticsRepository` is aggregate SQL (`FILTER`ed
 * counts, a pre-aggregated join so an order's total isn't summed once per
 * ticket, half-open UTC date bounds), which only a real database can check.
 *
 * Every query runs through `createReadOnlyDb`, the same connection the MCP
 * server uses, so this also proves the analytics queries work in a
 * read-only session — and that the session really refuses writes.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleAnalyticsRepository } from '../../src/infrastructure/db/drizzle-analytics.repository.js';
import { STATEMENT_TIMEOUT_MS, assertReadOnlySession, createReadOnlyDb, type ReadOnlyDatabase } from '../../src/infrastructure/db/read-only-client.js';
import * as schema from '../../src/infrastructure/db/schema/index.js';
import { createTestDatabase, insertTestEvent, insertTestPerformanceWithSeats, type TestDatabase } from './test-db.js';

type OrderStatus = 'pending' | 'payment_processing' | 'completed' | 'cancelled';

/** Postgres SQLSTATE for a write attempted in a read-only transaction. */
const READ_ONLY_SQL_TRANSACTION = '25006';
/** Postgres SQLSTATE for a statement cancelled by statement_timeout. */
const QUERY_CANCELED = '57014';

describe('DrizzleAnalyticsRepository (through a read-only connection)', () => {
  let testDb: TestDatabase;
  let readOnly: ReadOnlyDatabase;
  let repository: DrizzleAnalyticsRepository;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    readOnly = createReadOnlyDb(testDb.databaseUrl);
    repository = new DrizzleAnalyticsRepository(readOnly.db);
  }, 30000);

  afterAll(async () => {
    await readOnly?.pool.end();
    await testDb?.teardown();
  }, 30000);

  /** Inserts an order and one item per seat, with a chosen status, total and creation time — writes go through the test's own read-write connection. */
  async function insertOrder(
    performanceId: string,
    seatIds: string[],
    { status, totalAmount, createdAt }: { status: OrderStatus; totalAmount: number; createdAt: string }
  ): Promise<void> {
    const orderId = randomUUID();
    const userId = randomUUID();
    await testDb.db.insert(schema.ordersTable).values({
      id: orderId,
      userId,
      email: `${userId}@example.com`,
      performanceId,
      status,
      totalAmount,
      createdAt: new Date(createdAt),
    });
    await testDb.db.insert(schema.orderItemsTable).values(seatIds.map((seatId) => ({ orderId, seatId, price: 1000 })));
  }

  describe('getPerformanceOccupancy', () => {
    it('counts seats per status, upcoming only unless includePast', async () => {
      const eventId = await insertTestEvent(testDb.db, { title: 'Occupancy Event' });
      const upcoming = await insertTestPerformanceWithSeats(
        testDb.db,
        [
          { status: 'sold' },
          { status: 'sold' },
          { status: 'sold' },
          { status: 'reserved' },
          { status: 'available' },
          { status: 'available' },
          { status: 'blocked' },
        ],
        { eventId, date: '2026-12-01', time: '20:00:00' }
      );
      const past = await insertTestPerformanceWithSeats(testDb.db, [{ status: 'sold' }], { eventId, date: '2020-01-01' });

      const rows = await repository.getPerformanceOccupancy({ eventId, includePast: false, today: '2026-10-06' });
      expect(rows).toEqual([
        {
          performanceId: upcoming.performanceId,
          eventId,
          eventTitle: 'Occupancy Event',
          date: '2026-12-01',
          time: '20:00:00',
          venue: 'Test Venue',
          city: 'Test City',
          status: 'scheduled',
          totalSeats: 7,
          soldSeats: 3,
          heldSeats: 1,
          availableSeats: 2,
          blockedSeats: 1,
        },
      ]);

      const withPast = await repository.getPerformanceOccupancy({ eventId, includePast: true, today: '2026-10-06' });
      expect(withPast.map((r) => r.performanceId)).toEqual([past.performanceId, upcoming.performanceId]);
    });

    it('lists a performance with no seats with zero counts', async () => {
      const eventId = await insertTestEvent(testDb.db);
      await testDb.db.insert(schema.performancesTable).values({
        id: randomUUID(),
        eventId,
        date: '2026-12-02',
        time: '20:00:00',
        venue: 'Empty Hall',
        city: 'Nowhere',
        capacity: 0,
      });

      const [row] = await repository.getPerformanceOccupancy({ eventId, includePast: false, today: '2026-10-06' });
      expect(row).toMatchObject({ totalSeats: 0, soldSeats: 0, heldSeats: 0, availableSeats: 0, blockedSeats: 0 });
    });
  });

  describe('revenue and funnel over a date range', () => {
    // A range of its own (March 2025), so orders inserted by other tests in this file can't fall inside it.
    // Counted in Madrid time, and it spans the 30 March 2025 clock change: March starts in CET (UTC+1)
    // and ends in CEST (UTC+2), so its bounds are 2025-02-28T23:00Z and 2025-03-31T22:00Z.
    const range = { from: '2025-03-01', to: '2025-03-31', timeZone: 'Europe/Madrid' };
    let eventA: { eventId: string; performanceId: string; seatIds: string[] };
    let eventB: { eventId: string; performanceId: string; seatIds: string[] };

    /** A performance with `seatCount` sold seats, under a fresh event titled `title`. */
    async function soldOutPerformance(title: string, seatCount: number, date: string) {
      const eventId = await insertTestEvent(testDb.db, { title });
      const seats = Array.from({ length: seatCount }, () => ({ status: 'sold' as const }));
      const { performanceId, seatIds } = await insertTestPerformanceWithSeats(testDb.db, seats, { eventId, date });
      return { eventId, performanceId, seatIds };
    }

    beforeAll(async () => {
      eventA = await soldOutPerformance('Event A', 8, '2025-04-10');
      eventB = await soldOutPerformance('Event B', 2, '2025-04-11');

      const [a1, a2, a3, a4, a5, a6, a7] = eventA.seatIds;
      // In range.
      await insertOrder(eventA.performanceId, [a1, a2], { status: 'completed', totalAmount: 33000, createdAt: '2025-03-10T12:00:00Z' });
      // 23:59:59 on 31 March in Madrid (CEST).
      await insertOrder(eventA.performanceId, [a3], { status: 'completed', totalAmount: 16500, createdAt: '2025-03-31T21:59:59Z' });
      // 00:00 on 1 March in Madrid (CET) — still 28 February in UTC, so a UTC range would miss it.
      await insertOrder(eventB.performanceId, [eventB.seatIds[0]], { status: 'completed', totalAmount: 5500, createdAt: '2025-02-28T23:00:00Z' });
      await insertOrder(eventA.performanceId, [a4], { status: 'cancelled', totalAmount: 11000, createdAt: '2025-03-15T09:00:00Z' });
      await insertOrder(eventA.performanceId, [a5], { status: 'pending', totalAmount: 5000, createdAt: '2025-03-20T09:00:00Z' });
      // Just outside the range on either side.
      // 23:59:59 on 28 February in Madrid.
      await insertOrder(eventA.performanceId, [a6], { status: 'completed', totalAmount: 99900, createdAt: '2025-02-28T22:59:59Z' });
      // 00:00 on 1 April in Madrid — still 31 March in UTC, so a UTC range would wrongly include it.
      await insertOrder(eventA.performanceId, [a7], { status: 'completed', totalAmount: 99900, createdAt: '2025-03-31T22:00:00Z' });
    }, 30000);

    it('sums completed revenue per event, counting tickets without double-counting totals', async () => {
      const rows = await repository.getRevenue(range, 'event');
      expect(rows).toEqual([
        {
          eventId: eventA.eventId,
          eventTitle: 'Event A',
          performanceId: null,
          date: null,
          time: null,
          completedOrders: 2,
          ticketsSold: 3,
          revenueCents: 49500,
        },
        {
          eventId: eventB.eventId,
          eventTitle: 'Event B',
          performanceId: null,
          date: null,
          time: null,
          completedOrders: 1,
          ticketsSold: 1,
          revenueCents: 5500,
        },
      ]);
    });

    it('groups per performance when asked', async () => {
      const rows = await repository.getRevenue(range, 'performance');
      expect(rows[0]).toMatchObject({
        eventId: eventA.eventId,
        performanceId: eventA.performanceId,
        date: '2025-04-10',
        time: '20:00:00',
        revenueCents: 49500,
      });
    });

    it('counts orders per status within the range', async () => {
      const rows = await repository.getOrderFunnel(range);
      const byStatus = Object.fromEntries(rows.map((r) => [r.status, { orders: r.orders, amountCents: r.amountCents }]));
      expect(byStatus).toEqual({
        completed: { orders: 3, amountCents: 55000 },
        cancelled: { orders: 1, amountCents: 11000 },
        pending: { orders: 1, amountCents: 5000 },
      });
    });
  });

  it('passes assertReadOnlySession only for a read-only session', async () => {
    await expect(assertReadOnlySession(readOnly.db)).resolves.toBeUndefined();
    // The test's own read-write connection is exactly what the startup check must catch.
    await expect(assertReadOnlySession(testDb.db)).rejects.toThrow(/not read-only/);
  });

  it('has Postgres cancel a statement that runs past the timeout', async () => {
    const err = await readOnly.db.execute(sql`select pg_sleep(${(STATEMENT_TIMEOUT_MS + 1000) / 1000})`).then(
      () => null,
      (e: unknown) => e as { code?: string; cause?: { code?: string } }
    );
    // 57014 = query_canceled by the server — not the client-side query_timeout, which has no SQLSTATE.
    expect(err?.code ?? err?.cause?.code).toBe(QUERY_CANCELED);
    // The connection is still usable afterwards.
    await expect(assertReadOnlySession(readOnly.db)).resolves.toBeUndefined();
  }, 15000);

  it('refuses writes on the read-only connection', async () => {
    const attempt = readOnly.db.insert(schema.eventsTable).values({ id: randomUUID(), title: 'Should never exist' });
    const err = await attempt.then(
      () => null,
      (e: unknown) => e as { code?: string; cause?: { code?: string } }
    );
    expect(err).not.toBeNull();
    expect(err?.code ?? err?.cause?.code).toBe(READ_ONLY_SQL_TRANSACTION);
  });
});

