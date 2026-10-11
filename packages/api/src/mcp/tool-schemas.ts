import { z } from 'zod';

/**
 * Input shapes for the MCP server's tools, in the raw-shape form
 * `McpServer.registerTool` takes. Like the route layer's Zod schemas, these
 * have a single consumer (this adapter), so they live here rather than in
 * `domain/`. Format checks only — semantic rules (`from` before `to`, the
 * maximum span) belong to `AnalyticsService.resolveRange`.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD');

const dateRange = {
  from: isoDate.optional().describe('First day to include, YYYY-MM-DD, Europe/Madrid time. Defaults to 29 days before `to`.'),
  to: isoDate.optional().describe('Last day to include, YYYY-MM-DD, Europe/Madrid time. Defaults to today.'),
};

export const listEventsShape = {};

export const listPerformancesShape = {
  eventId: z.string().min(1).describe('Id of the event, as returned by list_events'),
};

export const performanceOccupancyShape = {
  eventId: z.string().min(1).optional().describe('Limit to one event (id from list_events). Omit for every event.'),
  includePast: z.boolean().optional().describe('Include performances dated before today. Defaults to false.'),
};

export const revenueSummaryShape = {
  ...dateRange,
  groupBy: z
    .enum(['event', 'performance'])
    .optional()
    .describe('Group revenue per event (default) or per individual performance.'),
};

export const orderFunnelShape = {
  ...dateRange,
};
