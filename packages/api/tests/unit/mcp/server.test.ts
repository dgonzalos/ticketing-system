import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsService } from '../../../src/domain/analytics/analytics.service.js';
import { EventNotFoundError, InvalidDateRangeError } from '../../../src/domain/common/errors/domain-errors.js';
import type { EventCatalog } from '../../../src/domain/events/event-catalog.js';
import { createAnalyticsMcpServer } from '../../../src/mcp/server.js';

/**
 * Drives the real MCP server through an in-memory transport and the SDK's
 * own client — the same protocol path Claude Code takes over stdio, minus
 * the process boundary.
 */

function createMocks() {
  const analyticsService = {
    getPerformanceOccupancy: vi.fn().mockResolvedValue([]),
    getRevenueSummary: vi.fn().mockResolvedValue({ totals: { revenueCents: 0 } }),
    getOrderFunnel: vi.fn().mockResolvedValue({ totalOrders: 0 }),
  };
  const eventCatalog = {
    listEvents: vi.fn().mockResolvedValue([{ eventId: 'event-1', title: 'Hamlet' }]),
    listPerformancesByEvent: vi.fn().mockResolvedValue([]),
  };
  return { analyticsService, eventCatalog };
}

let client: Client | undefined;

async function connect(mocks = createMocks()) {
  const server = createAnalyticsMcpServer({
    analyticsService: mocks.analyticsService as unknown as AnalyticsService,
    eventCatalog: mocks.eventCatalog as unknown as EventCatalog,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, ...mocks };
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const [first] = result.content as Array<{ type: string; text: string }>;
  return first.text;
}

afterEach(async () => {
  await client?.close();
  client = undefined;
});

describe('seatly-analytics MCP server', () => {
  it('exposes exactly the five read-only query tools', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual(
      ['list_events', 'list_performances', 'order_funnel', 'performance_occupancy', 'revenue_summary'].sort()
    );
    for (const tool of tools) {
      // The server's contract is query-only: a tool named like a write, or not annotated read-only, fails here.
      expect(tool.name).not.toMatch(/create|update|delete|cancel|set|insert|remove|write/i);
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });

  it('routes list_events to the catalog and returns JSON', async () => {
    const { client, eventCatalog } = await connect();
    const result = await client.callTool({ name: 'list_events', arguments: {} });

    expect(eventCatalog.listEvents).toHaveBeenCalledOnce();
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual([{ eventId: 'event-1', title: 'Hamlet' }]);
  });

  it('passes tool arguments through to the analytics service', async () => {
    const { client, analyticsService } = await connect();

    await client.callTool({ name: 'performance_occupancy', arguments: { eventId: 'event-1', includePast: true } });
    await client.callTool({ name: 'revenue_summary', arguments: { from: '2026-09-01', to: '2026-09-30', groupBy: 'performance' } });
    await client.callTool({ name: 'order_funnel', arguments: {} });

    expect(analyticsService.getPerformanceOccupancy).toHaveBeenCalledWith({ eventId: 'event-1', includePast: true });
    expect(analyticsService.getRevenueSummary).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-30', groupBy: 'performance' });
    expect(analyticsService.getOrderFunnel).toHaveBeenCalledWith({});
  });

  it('rejects malformed input before reaching the service', async () => {
    const { client, analyticsService } = await connect();
    const result = await client.callTool({ name: 'revenue_summary', arguments: { from: '01/09/2026' } });

    expect(result.isError).toBe(true);
    expect(analyticsService.getRevenueSummary).not.toHaveBeenCalled();
  });

  it("returns a domain error's message as an isError result", async () => {
    const mocks = createMocks();
    mocks.analyticsService.getOrderFunnel.mockRejectedValue(new InvalidDateRangeError('"from" (2026-05-02) is after "to" (2026-05-01)'));
    mocks.eventCatalog.listPerformancesByEvent.mockRejectedValue(new EventNotFoundError('nope'));
    const { client } = await connect(mocks);

    const funnel = await client.callTool({ name: 'order_funnel', arguments: { from: '2026-05-02', to: '2026-05-01' } });
    expect(funnel.isError).toBe(true);
    expect(textOf(funnel)).toContain('is after');

    const performances = await client.callTool({ name: 'list_performances', arguments: { eventId: 'nope' } });
    expect(performances.isError).toBe(true);
    expect(textOf(performances)).toContain('nope');
  });

  it('hides unexpected errors behind a generic message', async () => {
    const mocks = createMocks();
    mocks.eventCatalog.listEvents.mockRejectedValue(new Error('relation "secret_table" does not exist'));
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = await connect(mocks);

    const result = await client.callTool({ name: 'list_events', arguments: {} });

    expect(result.isError).toBe(true);
    expect(textOf(result)).not.toContain('secret_table');
    expect(stderr).toHaveBeenCalled();
    stderr.mockRestore();
  });
});
