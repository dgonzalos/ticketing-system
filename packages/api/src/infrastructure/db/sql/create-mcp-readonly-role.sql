-- Creates (or re-syncs) seatly_mcp_readonly: the SELECT-only Postgres role the
-- read-only MCP server (packages/api/src/mcp/) connects as via MCP_DATABASE_URL.
--
-- This is the layer that makes the MCP server read-only at the database
-- level: whatever the code does, this role cannot write, and it cannot read
-- customer data. It can read:
--   * events, performances           all columns
--   * seats                          everything except reserved_by (a user id)
--   * orders                         everything except email, user_id, stripe_session_id
--   * order_items                    all columns
-- and nothing else: no users, ai_usage_daily, or ai_admin_actions.
-- If a future analytics query needs another column, grant that column here
-- deliberately; never grant the whole table.
--
-- Not a Drizzle migration on purpose: roles are cluster-wide, need a password,
-- and the app's own role may lack CREATEROLE.
--
-- Run with psql as a role that can create roles (the local superuser, or
-- Neon's owner role). Re-running is safe: it updates the password and
-- re-applies the grants.
--
--   psql "<admin connection string>" -v password='<new password>' \
--        -f packages/api/src/infrastructure/db/sql/create-mcp-readonly-role.sql
--
-- Then put the connection string in .env.mcp at the repo root (gitignored;
-- the MCP launchers load only that file, never the root .env):
--
--   MCP_DATABASE_URL=postgresql://seatly_mcp_readonly:<password>@localhost:5432/ticketing_dev
--
-- On Neon, use the direct connection string, not the -pooler host: the
-- server also sets default_transaction_read_only as a startup option, which
-- the pooler rejects.

\set ON_ERROR_STOP on

SELECT 'CREATE ROLE seatly_mcp_readonly LOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'seatly_mcp_readonly')
\gexec

ALTER ROLE seatly_mcp_readonly WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD :'password';
-- Every session this role opens is read-only, independent of the client.
ALTER ROLE seatly_mcp_readonly SET default_transaction_read_only = on;
-- Server-side time limits, so Postgres cancels a runaway query even if the
-- client has given up on it (the server also sets these per session).
ALTER ROLE seatly_mcp_readonly SET statement_timeout = '5s';
ALTER ROLE seatly_mcp_readonly SET idle_in_transaction_session_timeout = '10s';

SELECT format('GRANT CONNECT ON DATABASE %I TO seatly_mcp_readonly', current_database())
\gexec
GRANT USAGE ON SCHEMA public TO seatly_mcp_readonly;

-- Start from nothing so a re-run also removes anything granted by hand.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM seatly_mcp_readonly;

GRANT SELECT ON events, performances, order_items TO seatly_mcp_readonly;
GRANT SELECT (id, performance_id, "row", "number", zone, price, status, reserved_until, created_at, updated_at)
  ON seats TO seatly_mcp_readonly;
GRANT SELECT (id, performance_id, status, total_amount, created_at, updated_at)
  ON orders TO seatly_mcp_readonly;
