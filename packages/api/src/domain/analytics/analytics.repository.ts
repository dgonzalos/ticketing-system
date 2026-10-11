/**
 * Read models for admin analytics — the data behind the read-only MCP server
 * (`src/mcp/`). Every amount is integer cents, like the rest of the app.
 *
 * Deliberately carries no customer data (no emails, no user ids): whatever an
 * MCP client reads is forwarded to a model, and the database role this
 * context runs under (`infrastructure/db/sql/create-mcp-readonly-role.sql`)
 * can't read those columns anyway.
 */

/** Seat counts for one performance, by seat status. */
export interface PerformanceOccupancyRow {
  performanceId: string;
  eventId: string;
  eventTitle: string;
  date: string;
  time: string;
  venue: string;
  city: string;
  status: 'scheduled' | 'cancelled';
  totalSeats: number;
  soldSeats: number;
  /** Seats in an unpaid checkout hold (`reserved`). */
  heldSeats: number;
  availableSeats: number;
  /** Seats taken off sale when a performance was cancelled. */
  blockedSeats: number;
}

export type RevenueGroupBy = 'event' | 'performance';

/** Completed-order revenue for one event, or one performance. */
export interface RevenueRow {
  eventId: string;
  eventTitle: string;
  /** Set only when grouped by performance. */
  performanceId: string | null;
  date: string | null;
  time: string | null;
  completedOrders: number;
  ticketsSold: number;
  revenueCents: number;
}

export type OrderStatusName = 'pending' | 'payment_processing' | 'completed' | 'cancelled';

/** Orders in one status, created within the requested range. */
export interface OrderFunnelRow {
  status: OrderStatusName;
  orders: number;
  amountCents: number;
}

/**
 * Inclusive range of calendar dates, 'YYYY-MM-DD', as days in `timeZone`:
 * an order belongs to the range when its `created_at`, seen on a wall clock
 * in that zone, falls on one of those days.
 */
export interface DateRange {
  from: string;
  to: string;
  /** IANA time zone the days are counted in, e.g. 'Europe/Madrid'. */
  timeZone: string;
}

/**
 * Read-only persistence port for admin analytics. Query methods only — no
 * write method exists here, and none should be added: this interface backs
 * the MCP server, whose whole contract is that it can never change data.
 */
export interface IAnalyticsRepository {
  /**
   * Seat counts per performance, ordered by date then time. With `eventId`,
   * only that event's performances. Unless `includePast`, only performances
   * dated `today` or later. Includes cancelled performances.
   */
  getPerformanceOccupancy(options: { eventId?: string; includePast: boolean; today: string }): Promise<PerformanceOccupancyRow[]>;

  /**
   * Revenue from `completed` orders created within `range`, grouped by
   * event or by performance, highest revenue first.
   */
  getRevenue(range: DateRange, groupBy: RevenueGroupBy): Promise<RevenueRow[]>;

  /** Order counts and amounts per status for orders created within `range`. Statuses with no orders are omitted. */
  getOrderFunnel(range: DateRange): Promise<OrderFunnelRow[]>;
}
