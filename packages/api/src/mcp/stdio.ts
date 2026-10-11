/**
 * Entry point for Seatly's read-only analytics MCP server over stdio: an MCP
 * client (Claude Code, Claude Desktop) launches this as a child process and
 * talks JSON-RPC over its stdin/stdout. See `server.ts` for the tools and the
 * read-only guarantee.
 *
 * **Never write to stdout here** — not `console.log`, not a startup banner.
 * stdout *is* the protocol channel, and any stray byte corrupts the stream.
 * Diagnostics go to stderr (`console.error`), which clients show as the
 * server's log. For the same reason, launch it with plain `node` (see
 * `.mcp.json`), never through `pnpm`/`npx`, which print their own banners.
 *
 * Requires `MCP_DATABASE_URL`, pointing at the `seatly_mcp_readonly` role
 * (see `infrastructure/db/sql/create-mcp-readonly-role.sql`), and refuses to
 * start without it. There is deliberately no fallback to `DATABASE_URL`: the
 * app role can read every column, customer emails and password hashes
 * included, so falling back would leave "no PII reaches the model" resting on
 * every query naming its columns by hand. Launchers load only `.env.mcp`
 * (gitignored, holding just this variable) rather than the root `.env`, so
 * this process never sees the app's other secrets (Stripe, Anthropic, JWT).
 *
 * Not imported by `src/index.ts`: the HTTP API and this server are separate
 * processes that share only the domain and infrastructure code.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AnalyticsService } from '../domain/analytics/analytics.service.js';
import { EventCatalog } from '../domain/events/event-catalog.js';
import { DrizzleAnalyticsRepository } from '../infrastructure/db/drizzle-analytics.repository.js';
import { DrizzleEventRepository } from '../infrastructure/db/drizzle-event.repository.js';
import { assertReadOnlySession, createReadOnlyDb } from '../infrastructure/db/read-only-client.js';
import { MCP_SERVER_NAME, createAnalyticsMcpServer } from './server.js';

function resolveConnectionString(): string {
  const url = process.env.MCP_DATABASE_URL;
  if (!url) {
    throw new Error(
      'MCP_DATABASE_URL is not set. Create the read-only role ' +
        '(packages/api/src/infrastructure/db/sql/create-mcp-readonly-role.sql) and put its connection string in .env.mcp ' +
        'at the repo root. DATABASE_URL is deliberately not used: the app role can read customer data.'
    );
  }
  return url;
}

async function main(): Promise<void> {
  const { db, pool } = createReadOnlyDb(resolveConnectionString());
  // Fail closed: never serve a tool over a session Postgres would let write.
  await assertReadOnlySession(db).catch(async (err: unknown) => {
    await pool.end();
    throw err;
  });

  const server = createAnalyticsMcpServer({
    analyticsService: new AnalyticsService(new DrizzleAnalyticsRepository(db)),
    eventCatalog: new EventCatalog(new DrizzleEventRepository(db)),
  });

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void server
      .close()
      .then(() => pool.end())
      .finally(() => process.exit(0));
  };
  // The client ends the session by closing our stdin (or, on POSIX, a signal).
  process.stdin.on('close', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(new StdioServerTransport());
  console.error(`[${MCP_SERVER_NAME}] ready on stdio`);
}

main().catch((err) => {
  console.error(`[${MCP_SERVER_NAME}] failed to start:`, err);
  process.exit(1);
});
