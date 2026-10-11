import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index.js';

export interface ReadOnlyDatabase {
  db: NodePgDatabase<typeof schema>;
  /** For shutdown: `await pool.end()`. */
  pool: Pool;
}

/** Server-side cap on any one statement, in ms — Postgres cancels it (SQLSTATE 57014). */
export const STATEMENT_TIMEOUT_MS = 5000;

/**
 * Startup options for every session: read-only, plus server-side time limits.
 * The limits matter because `query_timeout` (below) only stops the *client*
 * waiting — the backend would keep running the abandoned aggregate, and a
 * model calling tools in a loop could stack those up. `statement_timeout`
 * makes Postgres itself cancel the query.
 */
const READ_ONLY_STARTUP_OPTIONS = [
  '-c default_transaction_read_only=on',
  `-c statement_timeout=${STATEMENT_TIMEOUT_MS}`,
  '-c idle_in_transaction_session_timeout=10000',
].join(' ');

/**
 * A database connection on which Postgres itself refuses every write — for
 * the read-only MCP server (`src/mcp/`).
 *
 * Every session starts with `default_transaction_read_only = on`, so an
 * INSERT/UPDATE/DELETE fails with SQLSTATE 25006 even when `connectionString`
 * points at a role that could write. That's the second line of defence; the
 * first is connecting as the `SELECT`-only role from
 * `sql/create-mcp-readonly-role.sql`.
 *
 * The connection string may not carry its own `options` parameter: `pg`
 * merges connection-string parameters *over* the config object, so
 * `?options=-c default_transaction_read_only=off` would silently replace the
 * startup option set here. Only URL-form connection strings are accepted, so
 * that check can't be sidestepped by another syntax. `assertReadOnlySession`
 * then checks the result at startup rather than trusting this reasoning.
 *
 * Deliberately separate from `client.ts`, whose singleton pool is bound to
 * `DATABASE_URL` (the app's read-write role) at import time.
 *
 * @throws {Error} If `connectionString` isn't a postgres:// URL or sets `options`.
 */
export function createReadOnlyDb(connectionString: string): ReadOnlyDatabase {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('Read-only connection string must be a postgres:// or postgresql:// URL');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('Read-only connection string must be a postgres:// or postgresql:// URL');
  }
  if (url.searchParams.has('options')) {
    throw new Error(
      'Read-only connection string must not set "options": it would override default_transaction_read_only'
    );
  }

  const pool = new Pool({
    connectionString,
    options: READ_ONLY_STARTUP_OPTIONS,
    // A backstop a little past the server's limit, so normally Postgres cancels
    // first and returns a clean error on a still-usable connection.
    query_timeout: STATEMENT_TIMEOUT_MS + 1000,
    max: 4,
  });
  return { db: drizzle(pool, { schema }), pool };
}

/**
 * Confirms, against the live server, that a session on `db` is read-only —
 * so a misconfiguration nobody anticipated (a pooler dropping the startup
 * option, a driver change) stops the MCP server at startup instead of
 * silently leaving it able to write.
 *
 * @throws {Error} If the session's `default_transaction_read_only` is not `on`.
 */
export async function assertReadOnlySession(db: NodePgDatabase<typeof schema>): Promise<void> {
  const result = await db.execute<{ default_transaction_read_only: string }>(sql`show default_transaction_read_only`);
  const setting = result.rows[0]?.default_transaction_read_only;
  if (setting !== 'on') {
    throw new Error(`Database session is not read-only (default_transaction_read_only = ${setting ?? 'unknown'})`);
  }
}
