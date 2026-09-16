/**
 * Creates/drops an isolated, throwaway Postgres database for one
 * integration test run — the same approach `packages/e2e/scripts/run-e2e.ts`
 * already uses for Playwright, adapted here for a single vitest file rather
 * than a whole child-process test run. Bypasses `infrastructure/db/client.ts`'s
 * singleton `Pool` entirely (that one is locked to `DATABASE_URL` at module
 * load time) so a test can point at its own database instead of the shared
 * dev database (`ticketing_dev`).
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { config as loadEnv } from 'dotenv';
import { Client, Pool } from 'pg';
import * as schema from '../../src/infrastructure/db/schema/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const migrationsFolder = path.join(__dirname, '../../drizzle/migrations');

/**
 * Explicit connection ceiling for every test database's `Pool` — set below
 * rather than left as node-postgres's implicit default, so a test that
 * needs to know the pool's capacity (e.g. to genuinely saturate it for a
 * concurrency test) can import this constant instead of hardcoding a number
 * that only agrees with the pool by comment.
 */
export const TEST_POOL_MAX = 10;

// Loads the same root .env the rest of the repo uses, so DATABASE_URL /
// E2E_ADMIN_DATABASE_URL are available without requiring the shell to have
// sourced them first.
loadEnv({ path: path.join(repoRoot, '.env'), quiet: true });

export interface TestDatabase {
  db: NodePgDatabase<typeof schema>;
  dbName: string;
  /** Drops the database. Call in `afterAll`. */
  teardown: () => Promise<void>;
}

/**
 * Drops `dbName`, terminating any lingering connections first (e.g. a
 * leaked pool from a killed test run, or this same database's own pool if
 * the caller didn't close it) — `DROP DATABASE` otherwise fails while
 * sessions are open.
 */
async function dropTestDatabase(adminDatabaseUrl: string, dbName: string): Promise<void> {
  const dropAdmin = new Client({ connectionString: adminDatabaseUrl });
  await dropAdmin.connect();
  try {
    await dropAdmin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [dbName]
    );
    await dropAdmin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  } finally {
    await dropAdmin.end();
  }
}

/**
 * Creates a uniquely-named database, migrates it to the current schema, and
 * returns a Drizzle instance connected to it plus a teardown function.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const baseDatabaseUrl = process.env.DATABASE_URL;
  if (!baseDatabaseUrl) {
    throw new Error('DATABASE_URL must be set (see repo root .env) to derive an isolated integration-test database.');
  }

  // CREATE DATABASE/DROP DATABASE require a role with the CREATEDB
  // privilege, which the app's normal DATABASE_URL role may not have —
  // same reasoning as run-e2e.ts's adminDatabaseUrl.
  const adminDatabaseUrl = process.env.E2E_ADMIN_DATABASE_URL || baseDatabaseUrl;

  const dbName = `ticketing_it_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

  const testDatabaseUrlObj = new URL(baseDatabaseUrl);
  testDatabaseUrlObj.pathname = `/${dbName}`;
  const testDatabaseUrl = testDatabaseUrlObj.toString();

  // The app's own role needs to own the new database — otherwise, when a
  // different (e.g. superuser) role creates it, Postgres 15+'s default "no
  // CREATE on public for non-owners" leaves the app role unable to create
  // tables in it (identical reasoning to run-e2e.ts's appRole).
  const appRole = decodeURIComponent(new URL(baseDatabaseUrl).username);

  const admin = new Client({ connectionString: adminDatabaseUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${dbName}" OWNER "${appRole}"`);
  } finally {
    await admin.end();
  }

  // From here on the database exists. Everything below is wrapped so that
  // if any of it fails — most plausibly `migrate()`, e.g. a bad migration
  // under active development — this function drops the database itself
  // before rethrowing, rather than leaking it: the caller has no `teardown`
  // handle to clean up with until this function actually returns one.
  try {
    const pool = new Pool({ connectionString: testDatabaseUrl, max: TEST_POOL_MAX });
    const db = drizzle(pool, { schema });

    await migrate(db, { migrationsFolder });

    const teardown = async (): Promise<void> => {
      await pool.end();
      await dropTestDatabase(adminDatabaseUrl, dbName);
    };

    return { db, dbName, teardown };
  } catch (err) {
    await dropTestDatabase(adminDatabaseUrl, dbName);
    throw err;
  }
}

const DEFAULT_TEST_SLOT = { date: '2026-12-01', time: '20:00:00', venue: 'Test Venue', city: 'Test City' };

/**
 * Inserts a minimal event row for a test fixture. Shared by every
 * integration test that needs *an* event to hang a performance off of but
 * doesn't care about its content.
 */
export async function insertTestEvent(
  db: NodePgDatabase<typeof schema>,
  overrides: Partial<typeof schema.eventsTable.$inferInsert> = {}
): Promise<string> {
  const id = overrides.id ?? randomUUID();
  await db.insert(schema.eventsTable).values({ title: 'Integration Test Event', description: null, imageUrl: null, ...overrides, id });
  return id;
}

/**
 * Inserts an event, a performance, and the given seats directly (bypassing
 * `generateSeatMap` — callers that need a handful of seats in specific
 * states, not a full generated venue). Shared by every integration test
 * that needs this exact shape, so a schema change only has one call site to
 * update instead of one per test file.
 */
export async function insertTestPerformanceWithSeats(
  db: NodePgDatabase<typeof schema>,
  seats: Array<Partial<typeof schema.seatsTable.$inferInsert>>,
  overrides: Partial<typeof schema.performancesTable.$inferInsert> = {}
): Promise<{ eventId: string; performanceId: string; seatIds: string[] }> {
  const eventId = await insertTestEvent(db);
  const performanceId = randomUUID();

  await db.insert(schema.performancesTable).values({
    id: performanceId,
    eventId,
    ...DEFAULT_TEST_SLOT,
    capacity: seats.length,
    ...overrides,
  });

  const rows = seats.map((seat, i) => ({
    id: randomUUID(),
    performanceId,
    row: 'A',
    number: i + 1,
    zone: 'premium',
    price: 15000,
    ...seat,
  })) as (typeof schema.seatsTable.$inferInsert)[];

  await db.insert(schema.seatsTable).values(rows);

  return { eventId, performanceId, seatIds: rows.map((r) => r.id) };
}
