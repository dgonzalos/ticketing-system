import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { AnalyticsService } from '../domain/analytics/analytics.service.js';
import { DomainError } from '../domain/common/errors/domain-errors.js';
import type { EventCatalog } from '../domain/events/event-catalog.js';
import {
  listEventsShape,
  listPerformancesShape,
  orderFunnelShape,
  performanceOccupancyShape,
  revenueSummaryShape,
} from './tool-schemas.js';

export const MCP_SERVER_NAME = 'seatly-analytics';
export const MCP_SERVER_VERSION = '1.0.0';

/** Every tool on this server only reads, from this server's own database. */
const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export interface AnalyticsMcpDependencies {
  analyticsService: AnalyticsService;
  eventCatalog: EventCatalog;
}

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/**
 * Runs a tool body, turning failures into an `isError` result the client's
 * model can read. Domain errors (unknown event, bad date range) carry a
 * message written for the caller; anything else is logged to stderr and
 * reported generically, so no stack trace or SQL reaches the client.
 */
async function run(tool: string, body: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return jsonResult(await body());
  } catch (err) {
    if (err instanceof DomainError) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
    console.error(`[${MCP_SERVER_NAME}] ${tool} failed:`, err);
    return { isError: true, content: [{ type: 'text', text: `${tool} failed unexpectedly; see the server log.` }] };
  }
}

/**
 * Builds Seatly's read-only analytics MCP server.
 *
 * **It can never create, update or delete data.** That holds in four
 * independent layers, so a mistake in one is caught by the next:
 * 1. Only query tools are registered here, each annotated read-only (a unit
 *    test pins the exact list).
 * 2. This function is given {@link AnalyticsService} and {@link EventCatalog}
 *    only — never `EventAdminService`, `OrderService`, `SeatLockManager` or
 *    `UserService` — so no code path from a tool reaches anything that
 *    writes. Same structural rule as `AdminToolExecutor`. Keep it that way:
 *    a write tool does not belong on this server.
 * 3. `stdio.ts` connects through `createReadOnlyDb`, whose sessions run with
 *    `default_transaction_read_only = on`.
 * 4. In real use it connects as `seatly_mcp_readonly`, a role with `SELECT`
 *    on a few columns and nothing else
 *    (`infrastructure/db/sql/create-mcp-readonly-role.sql`).
 *
 * Transport-agnostic: `stdio.ts` connects it to stdin/stdout; tests connect
 * it to an in-memory transport.
 */
export function createAnalyticsMcpServer({ analyticsService, eventCatalog }: AnalyticsMcpDependencies): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      instructions:
        'Read-only analytics for Seatly, a ticketing app for live theatre and music. ' +
        'All amounts are integer euro cents (12550 = 125,50 €). Date ranges are YYYY-MM-DD days in Europe/Madrid time (the business calendar); ' +
        'performance dates are the venue-local date. ' +
        'Use list_events to find event ids. These tools cannot change any data.',
    }
  );

  server.registerTool(
    'list_events',
    {
      title: 'List events',
      description: 'Lists every event in the catalogue: id, title, description.',
      inputSchema: listEventsShape,
      annotations: READ_ONLY,
    },
    () => run('list_events', () => eventCatalog.listEvents())
  );

  server.registerTool(
    'list_performances',
    {
      title: 'List performances',
      description: "Lists an event's scheduled performances: date, time, venue, city, capacity. Cancelled ones are left out.",
      inputSchema: listPerformancesShape,
      annotations: READ_ONLY,
    },
    ({ eventId }) => run('list_performances', () => eventCatalog.listPerformancesByEvent(eventId))
  );

  server.registerTool(
    'performance_occupancy',
    {
      title: 'Performance occupancy',
      description:
        'Seat counts per performance: total, sold, held (in an unpaid checkout, frees up when it expires), ' +
        'available, blocked (taken off sale by a cancellation), plus sell-through percent. ' +
        'Upcoming performances only unless includePast is true; includes cancelled performances.',
      inputSchema: performanceOccupancyShape,
      annotations: READ_ONLY,
    },
    (input) => run('performance_occupancy', () => analyticsService.getPerformanceOccupancy(input))
  );

  server.registerTool(
    'revenue_summary',
    {
      title: 'Revenue summary',
      description:
        'Revenue from completed (paid) orders created in a date range, per event or per performance, ' +
        'highest first (ties by event title, then date and time), with totals. Amounts include tax. Defaults to the last 30 days; at most 366 days.',
      inputSchema: revenueSummaryShape,
      annotations: READ_ONLY,
    },
    (input) => run('revenue_summary', () => analyticsService.getRevenueSummary(input))
  );

  server.registerTool(
    'order_funnel',
    {
      title: 'Order funnel',
      description:
        'How orders created in a date range ended up: count and amount per status ' +
        '(pending, payment_processing, completed, cancelled = checkout expired unpaid, seats released), ' +
        'plus the completion rate (completed / all orders in range). Orders still in checkout (pending, ' +
        'payment_processing) count as not completed, so for a range ending today the rate reads low until ' +
        'they settle (an unpaid Stripe checkout can stay open up to 24 hours before it expires). Defaults to the last 30 days; at most 366 days.',
      inputSchema: orderFunnelShape,
      annotations: READ_ONLY,
    },
    (input) => run('order_funnel', () => analyticsService.getOrderFunnel(input))
  );

  return server;
}
