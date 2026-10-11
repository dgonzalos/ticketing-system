import { and, asc, desc, eq, gte, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type {
  DateRange,
  IAnalyticsRepository,
  OrderFunnelRow,
  PerformanceOccupancyRow,
  RevenueGroupBy,
  RevenueRow,
} from '../../domain/analytics/analytics.repository.js';
import * as schema from './schema/index.js';

/**
 * Whether an order's `created_at` falls on one of `range`'s days, as seen on
 * a wall clock in `range.timeZone`: [`from` 00:00, day after `to` 00:00)
 * local time. Postgres turns each local midnight into an instant with
 * `AT TIME ZONE`, so a daylight-saving change inside the range is handled by
 * the time zone database, not by hand. Both bounds are constants, so the
 * comparison stays index-friendly and independent of the session time zone.
 */
function createdWithin(range: DateRange): SQL {
  const o = schema.ordersTable;
  return sql`${o.createdAt} >= (${range.from}::date)::timestamp at time zone ${range.timeZone}
    and ${o.createdAt} < (${range.to}::date + 1)::timestamp at time zone ${range.timeZone}`;
}

const countWhereStatus = (status: string) =>
  sql<number>`count(${schema.seatsTable.id}) filter (where ${schema.seatsTable.status} = ${status})`.mapWith(Number);

/**
 * Drizzle/PostgreSQL implementation of {@link IAnalyticsRepository}: one
 * aggregate query per method, `SELECT` only.
 *
 * Every query names its columns explicitly — never `select()` of a whole
 * table — because the MCP server's read-only role
 * (`sql/create-mcp-readonly-role.sql`) is granted only some columns of
 * `seats` and `orders`; selecting a column outside that grant fails with a
 * permission error instead of silently leaking it.
 */
export class DrizzleAnalyticsRepository implements IAnalyticsRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async getPerformanceOccupancy(options: { eventId?: string; includePast: boolean; today: string }): Promise<PerformanceOccupancyRow[]> {
    const p = schema.performancesTable;
    const e = schema.eventsTable;
    const s = schema.seatsTable;

    const conditions: SQL[] = [];
    if (options.eventId) conditions.push(eq(p.eventId, options.eventId));
    if (!options.includePast) conditions.push(gte(p.date, options.today));

    return this.db
      .select({
        performanceId: p.id,
        eventId: p.eventId,
        eventTitle: e.title,
        date: p.date,
        time: p.time,
        venue: p.venue,
        city: p.city,
        status: p.status,
        totalSeats: sql<number>`count(${s.id})`.mapWith(Number),
        soldSeats: countWhereStatus('sold'),
        heldSeats: countWhereStatus('reserved'),
        availableSeats: countWhereStatus('available'),
        blockedSeats: countWhereStatus('blocked'),
      })
      .from(p)
      .innerJoin(e, eq(e.id, p.eventId))
      .leftJoin(s, eq(s.performanceId, p.id))
      .where(and(...conditions))
      .groupBy(p.id, e.title)
      .orderBy(asc(p.date), asc(p.time));
  }

  async getRevenue(range: DateRange, groupBy: RevenueGroupBy): Promise<RevenueRow[]> {
    const o = schema.ordersTable;
    const i = schema.orderItemsTable;
    const p = schema.performancesTable;
    const e = schema.eventsTable;

    // Tickets per order, aggregated before the join so an order's total
    // isn't summed once per item.
    const itemCounts = this.db
      .select({ orderId: i.orderId, tickets: sql<number>`count(${i.id})`.as('tickets') })
      .from(i)
      .groupBy(i.orderId)
      .as('item_counts');

    const byPerformance = groupBy === 'performance';
    const revenueCents = sql<number>`coalesce(sum(${o.totalAmount}), 0)`.mapWith(Number);

    const rows = await this.db
      .select({
        eventId: e.id,
        eventTitle: e.title,
        performanceId: byPerformance ? p.id : sql<string | null>`null`,
        date: byPerformance ? p.date : sql<string | null>`null`,
        time: byPerformance ? p.time : sql<string | null>`null`,
        completedOrders: sql<number>`count(${o.id})`.mapWith(Number),
        ticketsSold: sql<number>`coalesce(sum(${itemCounts.tickets}), 0)`.mapWith(Number),
        revenueCents,
      })
      .from(o)
      .innerJoin(p, eq(p.id, o.performanceId))
      .innerJoin(e, eq(e.id, p.eventId))
      .leftJoin(itemCounts, eq(itemCounts.orderId, o.id))
      .where(and(eq(o.status, 'completed'), createdWithin(range)))
      .groupBy(...(byPerformance ? [e.id, e.title, p.id] : [e.id, e.title]))
      // Ties broken down to a unique key, so equal-revenue rows always come back in the same order.
      .orderBy(desc(revenueCents), asc(e.title), asc(e.id), ...(byPerformance ? [asc(p.date), asc(p.time), asc(p.id)] : []));

    return rows;
  }

  async getOrderFunnel(range: DateRange): Promise<OrderFunnelRow[]> {
    const o = schema.ordersTable;

    return this.db
      .select({
        status: o.status,
        orders: sql<number>`count(${o.id})`.mapWith(Number),
        amountCents: sql<number>`coalesce(sum(${o.totalAmount}), 0)`.mapWith(Number),
      })
      .from(o)
      .where(createdWithin(range))
      .groupBy(o.status);
  }
}
