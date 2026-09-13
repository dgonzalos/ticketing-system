/**
 * Integration test against a real (throwaway) Postgres database — see
 * `../test-db.ts`. Exists because the behavior under test is
 * `DrizzleUsageBudgetRepository.recordUsage`'s single
 * `INSERT ... ON CONFLICT (date) DO UPDATE SET x = x + excluded.x` upsert —
 * the first `onConflictDoUpdate` in this codebase. A mocked-repository unit
 * test (`tests/unit/domain/ai/ai-budget-guard.test.ts`) can only assert that
 * `AiBudgetGuard` calls `recordUsage` with the right arguments; it can't
 * exercise whether the underlying SQL actually adds onto an existing row
 * (rather than clobbering it) or genuinely holds up under two connections
 * writing to the same day at once.
 */
import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { DrizzleUsageBudgetRepository } from '../../../src/infrastructure/db/drizzle-usage-budget.repository.js';
import * as schema from '../../../src/infrastructure/db/schema/index.js';
import { createTestDatabase, type TestDatabase } from '../test-db.js';

describe('DrizzleUsageBudgetRepository', () => {
  let testDb: TestDatabase;
  let repository: DrizzleUsageBudgetRepository;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    repository = new DrizzleUsageBudgetRepository(testDb.db);
  }, 30000);

  afterAll(async () => {
    await testDb?.teardown();
  }, 30000);

  // Every row is keyed by "today", so each test would otherwise see the
  // previous test's accumulated total — clear it first for an isolated
  // starting point per test.
  beforeEach(async () => {
    await testDb.db.delete(schema.aiUsageDailyTable);
  });

  it('returns 0 when no row exists yet for today', async () => {
    await expect(repository.getTodaySpendUsd()).resolves.toBe(0);
  });

  it('accumulates sequential recordUsage calls instead of overwriting', async () => {
    await repository.recordUsage({
      inputTokens: 100,
      cacheWriteTokens: 10,
      cacheReadTokens: 20,
      outputTokens: 50,
      costUsd: 0.01,
    });
    await repository.recordUsage({
      inputTokens: 200,
      cacheWriteTokens: 5,
      cacheReadTokens: 0,
      outputTokens: 25,
      costUsd: 0.02,
    });

    await expect(repository.getTodaySpendUsd()).resolves.toBeCloseTo(0.03, 10);

    const [row] = await testDb.db.select().from(schema.aiUsageDailyTable);
    expect(row).toMatchObject({
      inputTokens: 300,
      cacheWriteTokens: 15,
      cacheReadTokens: 20,
      outputTokens: 75,
    });
  });

  it('adds up correctly when two recordUsage calls race on the same day', async () => {
    await Promise.all([
      repository.recordUsage({ inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: 0.001 }),
      repository.recordUsage({ inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: 0.001 }),
    ]);

    // If either concurrent write were lost to a race, this would land on
    // 0.001 / 1 instead of 0.002 / 2.
    await expect(repository.getTodaySpendUsd()).resolves.toBeCloseTo(0.002, 10);

    const [row] = await testDb.db.select().from(schema.aiUsageDailyTable);
    expect(row?.inputTokens).toBe(2);
  });
});
