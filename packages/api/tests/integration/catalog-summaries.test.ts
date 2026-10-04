/**
 * Integration test against a real (throwaway) Postgres database — see
 * `test-db.ts`. Exists because the public catalog read models are computed
 * entirely in SQL (`DrizzleEventRepository.listEventSummaries` /
 * `listPerformanceSummariesByEvent`: LEFT JOIN + `FILTER`ed aggregates, a
 * window-ranked "next performance", date/status cutoffs). A mocked-catalog
 * route test can only check those numbers are passed through; only a real
 * database can show the aggregates themselves are right.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleEventRepository } from '../../src/infrastructure/db/drizzle-event.repository.js';
import * as schema from '../../src/infrastructure/db/schema/index.js';
import { createTestDatabase, insertTestEvent, type TestDatabase } from './test-db.js';

/** Pinned "today" — the repository takes it as a parameter precisely so tests can do this. */
const TODAY = '2026-10-10';

type SeatFixture = { status: 'available' | 'reserved' | 'sold' | 'blocked'; price: number };

const reservedHold = () => ({ reservedBy: randomUUID(), reservedUntil: new Date(Date.now() + 5 * 60 * 1000) });

describe('DrizzleEventRepository public summaries', () => {
  let testDb: TestDatabase;
  let repository: DrizzleEventRepository;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    repository = new DrizzleEventRepository(testDb.db);
  }, 30000);

  afterAll(async () => {
    await testDb?.teardown();
  }, 30000);

  /** Adds one performance with the given seats to an existing event. */
  async function addPerformance(
    eventId: string,
    slot: { date: string; time: string; status?: 'scheduled' | 'cancelled'; venue?: string },
    seats: SeatFixture[]
  ): Promise<string> {
    const performanceId = randomUUID();
    await testDb.db.insert(schema.performancesTable).values({
      id: performanceId,
      eventId,
      date: slot.date,
      time: slot.time,
      venue: slot.venue ?? `Venue ${performanceId.slice(0, 8)}`,
      city: 'Madrid',
      capacity: seats.length,
      status: slot.status ?? 'scheduled',
    });
    if (seats.length > 0) {
      await testDb.db.insert(schema.seatsTable).values(
        seats.map((seat, i) => ({
          id: randomUUID(),
          performanceId,
          row: 'A',
          number: i + 1,
          zone: 'test',
          price: seat.price,
          status: seat.status,
          ...(seat.status === 'reserved' ? reservedHold() : {}),
        }))
      );
    }
    return performanceId;
  }

  async function eventSummary(eventId: string) {
    const summaries = await repository.listEventSummaries(TODAY);
    return summaries.find((s) => s.eventId === eventId);
  }

  describe('listPerformanceSummariesByEvent', () => {
    it('counts only available seats, and prices from the cheapest available one — ignoring reserved and sold', async () => {
      const eventId = await insertTestEvent(testDb.db);
      await addPerformance(eventId, { date: '2026-10-20', time: '19:30:00' }, [
        { status: 'reserved', price: 1000 },
        { status: 'sold', price: 2000 },
        { status: 'available', price: 9000 },
        { status: 'available', price: 5000 },
        { status: 'blocked', price: 500 },
      ]);

      const [summary] = await repository.listPerformanceSummariesByEvent(eventId, TODAY);

      expect(summary).toMatchObject({
        availableSeats: 2,
        fromPriceCents: 5000,
        heldSeats: 1,
        date: '2026-10-20',
        time: '19:30:00',
      });
    });

    it('reports a sold-out performance as 0 available, no price, nothing held', async () => {
      const eventId = await insertTestEvent(testDb.db);
      await addPerformance(eventId, { date: '2026-10-20', time: '19:30:00' }, [
        { status: 'sold', price: 5000 },
        { status: 'blocked', price: 5000 },
      ]);

      const [summary] = await repository.listPerformanceSummariesByEvent(eventId, TODAY);

      expect(summary).toMatchObject({ availableSeats: 0, fromPriceCents: null, heldSeats: 0 });
    });

    it('tells a performance whose last seats are only held apart from a sold-out one', async () => {
      const eventId = await insertTestEvent(testDb.db);
      await addPerformance(eventId, { date: '2026-10-20', time: '19:30:00' }, [
        { status: 'sold', price: 5000 },
        { status: 'reserved', price: 5000 },
        { status: 'reserved', price: 9000 },
      ]);

      const [summary] = await repository.listPerformanceSummariesByEvent(eventId, TODAY);

      expect(summary).toMatchObject({ availableSeats: 0, fromPriceCents: null, heldSeats: 2 });
    });

    it('excludes past and cancelled performances, keeps today, and sorts by date then time', async () => {
      const eventId = await insertTestEvent(testDb.db);
      await addPerformance(eventId, { date: '2026-10-09', time: '20:00:00' }, [{ status: 'available', price: 5000 }]);
      await addPerformance(eventId, { date: '2026-10-12', time: '20:00:00', status: 'cancelled' }, [{ status: 'blocked', price: 5000 }]);
      const lateToday = await addPerformance(eventId, { date: TODAY, time: '21:30:00' }, [{ status: 'available', price: 5000 }]);
      const earlyToday = await addPerformance(eventId, { date: TODAY, time: '14:00:00' }, [{ status: 'available', price: 5000 }]);

      const summaries = await repository.listPerformanceSummariesByEvent(eventId, TODAY);

      expect(summaries.map((s) => s.performanceId)).toEqual([earlyToday, lateToday]);
    });
  });

  describe('listEventSummaries', () => {
    it('picks the earliest upcoming performance by date then time, and the cheapest available seat across all of them', async () => {
      const eventId = await insertTestEvent(testDb.db);
      await addPerformance(eventId, { date: '2026-10-25', time: '20:00:00' }, [{ status: 'available', price: 5000 }]);
      await addPerformance(eventId, { date: '2026-10-15', time: '21:30:00', venue: 'Late Show' }, [{ status: 'available', price: 15000 }]);
      await addPerformance(eventId, { date: '2026-10-15', time: '14:00:00', venue: 'Matinee' }, [
        { status: 'sold', price: 1000 },
        { status: 'reserved', price: 1000 },
      ]);
      // Past and cancelled performances must not count toward anything.
      await addPerformance(eventId, { date: '2026-10-01', time: '10:00:00' }, [
        { status: 'available', price: 100 },
        { status: 'reserved', price: 100 },
      ]);
      await addPerformance(eventId, { date: '2026-10-11', time: '10:00:00', status: 'cancelled' }, [{ status: 'blocked', price: 100 }]);

      const summary = await eventSummary(eventId);

      expect(summary).toMatchObject({
        nextPerformance: { date: '2026-10-15', time: '14:00:00', venue: 'Matinee', city: 'Madrid' },
        upcomingPerformanceCount: 3,
        fromPriceCents: 5000,
        heldSeats: 1,
      });
    });

    it('returns an event with nothing upcoming as null / 0 / null', async () => {
      const eventId = await insertTestEvent(testDb.db);
      await addPerformance(eventId, { date: '2026-10-01', time: '20:00:00' }, [{ status: 'available', price: 5000 }]);

      await expect(eventSummary(eventId)).resolves.toMatchObject({
        nextPerformance: null,
        upcomingPerformanceCount: 0,
        fromPriceCents: null,
        heldSeats: 0,
      });
    });

    it('keeps a fully sold-out event listed with its next date but no price', async () => {
      const eventId = await insertTestEvent(testDb.db);
      await addPerformance(eventId, { date: '2026-10-20', time: '19:30:00' }, [{ status: 'sold', price: 5000 }]);

      await expect(eventSummary(eventId)).resolves.toMatchObject({
        nextPerformance: { date: '2026-10-20', time: '19:30:00' },
        upcomingPerformanceCount: 1,
        fromPriceCents: null,
      });
    });

    it('orders events by next performance, with events that have nothing upcoming last', async () => {
      const later = await insertTestEvent(testDb.db, { title: 'Later' });
      const sooner = await insertTestEvent(testDb.db, { title: 'Sooner' });
      const nothing = await insertTestEvent(testDb.db, { title: 'Nothing upcoming' });
      await addPerformance(later, { date: '2026-12-30', time: '20:00:00' }, [{ status: 'available', price: 5000 }]);
      await addPerformance(sooner, { date: '2026-10-10', time: '00:30:00' }, [{ status: 'available', price: 5000 }]);

      const ids = (await repository.listEventSummaries(TODAY)).map((s) => s.eventId);

      expect(ids.indexOf(sooner)).toBeLessThan(ids.indexOf(later));
      expect(ids.indexOf(later)).toBeLessThan(ids.indexOf(nothing));
    });
  });
});
