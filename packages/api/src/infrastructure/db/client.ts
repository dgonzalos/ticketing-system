import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index.js';

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return url;
}

/**
 * Underlying pg connection pool, for lifecycle management (e.g. `await pool.end()`
 * on app shutdown). Most code should query through {@link db} instead.
 *
 * @throws {Error} If DATABASE_URL environment variable is not set.
 */
export const pool = new Pool({ connectionString: getDatabaseUrl() });

/**
 * Drizzle ORM database client for PostgreSQL, connected via node-postgres (pg
 * driver) using the DATABASE_URL environment variable.
 *
 * Usage:
 * ```typescript
 * import { db, pool } from './client';
 *
 * // Query
 * const seats = await db.select().from(seatsTable).execute();
 *
 * // Shutdown
 * await pool.end();
 * ```
 */
export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });
