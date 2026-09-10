/**
 * Integration test against a real (throwaway) Postgres database — see
 * `test-db.ts`. Exists specifically because the behavior under test lives
 * in `DrizzleEventRepository.cancelPerformance`'s SQL: a mocked-repository
 * unit test (see `tests/unit/domain/events/event-admin.service.test.ts`)
 * can only assert that the service *calls* `cancelPerformance` and maps its
 * returned outcome to the right error — it cannot exercise the actual
 * locked, atomic query, which is exactly what regressed once already (see
 * the two scenarios below, each guarding against a real bug this method
 * had at different points).
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleEventRepository } from '../../src/infrastructure/db/drizzle-event.repository.js';
import * as schema from '../../src/infrastructure/db/schema/index.js';
import { createTestDatabase, type TestDatabase } from './test-db.js';

describe('DrizzleEventRepository.cancelPerformance', () => {
  let testDb: TestDatabase;
  let repository: DrizzleEventRepository;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    repository = new DrizzleEventRepository(testDb.db);
  }, 30000);

  afterAll(async () => {
    await testDb?.teardown();
  }, 30000);

  async function insertFixture(seats: Array<Partial<typeof schema.seatsTable.$inferInsert>>): Promise<{
    eventId: string;
    performanceId: string;
  }> {
    const eventId = randomUUID();
    const performanceId = randomUUID();

    await testDb.db
      .insert(schema.eventsTable)
      .values({ id: eventId, title: 'Integration Test Event', description: null, imageUrl: null });

    await testDb.db.insert(schema.performancesTable).values({
      id: performanceId,
      eventId,
      date: '2026-12-01',
      time: '20:00:00',
      venue: 'Test Venue',
      city: 'Test City',
      capacity: seats.length,
    });

    await testDb.db.insert(schema.seatsTable).values(
      seats.map((seat, i) => ({
        id: randomUUID(),
        performanceId,
        row: 'A',
        number: i + 1,
        zone: 'premium',
        price: 15000,
        ...seat,
      })) as (typeof schema.seatsTable.$inferInsert)[]
    );

    return { eventId, performanceId };
  }

  it('returns not_found for an unknown performance', async () => {
    await expect(repository.cancelPerformance(randomUUID())).resolves.toBe('not_found');
  });

  it('cancels, releasing a reserved seat (an active, unpaid checkout hold) and blocking an available one', async () => {
    const { performanceId } = await insertFixture([
      {
        status: 'reserved',
        // An active, unpaid checkout hold — the case the fix guards:
        // cancelling must release it, or the holder could still complete
        // checkout and pay for a cancelled performance.
        reservedBy: randomUUID(),
        reservedUntil: new Date(Date.now() + 5 * 60 * 1000),
      },
      { status: 'available' },
    ]);

    await expect(repository.cancelPerformance(performanceId)).resolves.toBe('cancelled');

    const seats = await testDb.db.select().from(schema.seatsTable).where(eq(schema.seatsTable.performanceId, performanceId));
    for (const seat of seats) {
      expect(seat).toMatchObject({ status: 'blocked', reservedBy: null, reservedUntil: null });
    }

    const [performance] = await testDb.db
      .select()
      .from(schema.performancesTable)
      .where(eq(schema.performancesTable.id, performanceId));
    expect(performance.status).toBe('cancelled');
  });

  it('is idempotent: cancelling an already-cancelled performance returns cancelled without changing anything further', async () => {
    const { performanceId } = await insertFixture([{ status: 'available' }]);
    await repository.cancelPerformance(performanceId);

    await expect(repository.cancelPerformance(performanceId)).resolves.toBe('cancelled');
  });

  it('refuses (has_sales) and changes nothing when any seat has sold — even alongside reserved/available ones', async () => {
    const { performanceId } = await insertFixture([
      { status: 'sold' },
      {
        status: 'reserved',
        reservedBy: randomUUID(),
        reservedUntil: new Date(Date.now() + 5 * 60 * 1000),
      },
      { status: 'available' },
    ]);

    await expect(repository.cancelPerformance(performanceId)).resolves.toBe('has_sales');

    // Nothing changed — this is the atomicity the fix depends on: a
    // refused cancellation must be all-or-nothing, not "cancel everything
    // except the sold seat."
    const seats = await testDb.db.select().from(schema.seatsTable).where(eq(schema.seatsTable.performanceId, performanceId));
    const statuses = seats.map((seat) => seat.status).sort();
    expect(statuses).toEqual(['available', 'reserved', 'sold']);

    const [performance] = await testDb.db
      .select()
      .from(schema.performancesTable)
      .where(eq(schema.performancesTable.id, performanceId));
    expect(performance.status).toBe('scheduled');
  });
});
