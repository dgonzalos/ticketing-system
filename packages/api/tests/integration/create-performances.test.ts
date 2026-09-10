/**
 * Integration test against a real (throwaway) Postgres database — see
 * `test-db.ts`. Exists because the behavior under test is the
 * `performances_scheduled_slot_unique` partial unique index (see
 * `schema/performances.ts`) and `DrizzleEventRepository.createPerformances`'s
 * handling of violating it — a mocked-repository unit test
 * (`tests/unit/domain/events/event-admin.service.test.ts`) can only exercise
 * `EventAdminService`'s own in-memory/pre-check duplicate detection, which
 * is explicitly *not* what actually closes the race between two concurrent
 * identical requests (that's the database constraint tested here).
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleEventRepository } from '../../src/infrastructure/db/drizzle-event.repository.js';
import { PerformanceAlreadyScheduledError } from '../../src/domain/common/errors/domain-errors.js';
import type { NewPerformanceInput } from '../../src/domain/events/event.repository.js';
import { generateSeatMap } from '../../src/domain/seats/seat-map.js';
import * as schema from '../../src/infrastructure/db/schema/index.js';
import { createTestDatabase, type TestDatabase } from './test-db.js';

const SLOT = { date: '2026-12-01', time: '20:00:00', venue: 'Test Venue', city: 'Test City' };

describe('DrizzleEventRepository.createPerformances', () => {
  let testDb: TestDatabase;
  let repository: DrizzleEventRepository;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    repository = new DrizzleEventRepository(testDb.db);
  }, 30000);

  afterAll(async () => {
    await testDb?.teardown();
  }, 30000);

  async function insertEvent(): Promise<string> {
    const eventId = randomUUID();
    await testDb.db
      .insert(schema.eventsTable)
      .values({ id: eventId, title: 'Integration Test Event', description: null, imageUrl: null });
    return eventId;
  }

  function performanceInput(eventId: string, overrides: Partial<NewPerformanceInput> = {}): NewPerformanceInput {
    return { performanceId: randomUUID(), eventId, capacity: 100, ...SLOT, ...overrides };
  }

  it('rejects a second request for a slot an earlier request already scheduled, rolling back the whole attempt', async () => {
    const eventId = await insertEvent();

    await repository.createPerformances([performanceInput(eventId)], generateSeatMap);

    await expect(repository.createPerformances([performanceInput(eventId)], generateSeatMap)).rejects.toBeInstanceOf(
      PerformanceAlreadyScheduledError
    );

    const performances = await testDb.db.select().from(schema.performancesTable).where(eq(schema.performancesTable.eventId, eventId));
    expect(performances).toHaveLength(1);
  });

  it('rejects a batch containing two rows for the same slot, inserting nothing at all', async () => {
    const eventId = await insertEvent();

    await expect(
      repository.createPerformances([performanceInput(eventId), performanceInput(eventId)], generateSeatMap)
    ).rejects.toBeInstanceOf(PerformanceAlreadyScheduledError);

    const performances = await testDb.db.select().from(schema.performancesTable).where(eq(schema.performancesTable.eventId, eventId));
    expect(performances).toHaveLength(0);
  });

  it('allows re-scheduling the same slot once the earlier performance is cancelled', async () => {
    const eventId = await insertEvent();

    const [first] = await repository.createPerformances([performanceInput(eventId)], generateSeatMap);
    await repository.cancelPerformance(first.performanceId);

    await expect(repository.createPerformances([performanceInput(eventId)], generateSeatMap)).resolves.toHaveLength(1);

    const performances = await testDb.db.select().from(schema.performancesTable).where(eq(schema.performancesTable.eventId, eventId));
    expect(performances).toHaveLength(2);
    expect(performances.map((p) => p.status).sort()).toEqual(['cancelled', 'scheduled']);
  });
});
