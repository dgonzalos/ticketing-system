import { InvalidDateRangeError } from '../common/errors/domain-errors.js';
import type {
  DateRange,
  IAnalyticsRepository,
  OrderFunnelRow,
  OrderStatusName,
  PerformanceOccupancyRow,
  RevenueGroupBy,
  RevenueRow,
} from './analytics.repository.js';

export type { DateRange, RevenueGroupBy } from './analytics.repository.js';

/**
 * The business's own calendar, which analytics counts days in — the zone a
 * "March revenue" report is read in. It's one zone for the whole business,
 * not each venue's: venues span zones (Lisbon runs an hour behind Madrid),
 * and a per-venue clock would put orders from the same instant on different
 * days. Performance dates themselves are venue-local calendar dates and are
 * compared as plain dates.
 */
export const BUSINESS_TIME_ZONE = 'Europe/Madrid';

/** Length of the default range when the caller gives no `from`: the last 30 days, today included. */
export const DEFAULT_RANGE_DAYS = 30;
/** Longest range accepted, so one call can't aggregate the whole table forever. */
export const MAX_RANGE_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ORDER_STATUSES: OrderStatusName[] = ['pending', 'payment_processing', 'completed', 'cancelled'];

export interface PerformanceOccupancy extends PerformanceOccupancyRow {
  /** Sold seats as a share of all seats, one decimal; null for a performance with no seats. */
  sellThroughPercent: number | null;
}

export interface RevenueSummary {
  range: DateRange;
  groupBy: RevenueGroupBy;
  currency: 'EUR';
  totals: { completedOrders: number; ticketsSold: number; revenueCents: number };
  rows: RevenueRow[];
}

export interface OrderFunnel {
  range: DateRange;
  currency: 'EUR';
  /** Every status, zero-filled, in lifecycle order. */
  statuses: OrderFunnelRow[];
  totalOrders: number;
  /** Completed orders as a share of all orders in range, one decimal; null when there are none. */
  completionRatePercent: number | null;
}

function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 1000) / 10;
}

/**
 * Parses a 'YYYY-MM-DD' calendar date for day arithmetic only. The `Z` keeps
 * that arithmetic free of DST (every day is exactly 24 h in UTC); it says
 * nothing about which zone the day belongs to — that's {@link DateRange.timeZone}.
 */
function parseCalendarDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00Z`);
  // `new Date('2026-02-30T00:00:00Z')` rolls over to March instead of failing, so round-trip it.
  if (!DATE_PATTERN.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new InvalidDateRangeError(`"${value}" is not a valid date (expected YYYY-MM-DD)`);
  }
  return parsed;
}

function formatCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The calendar date `instant` falls on in `timeZone`, 'YYYY-MM-DD'. */
function calendarDateIn(timeZone: string, instant: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/**
 * Read-only admin analytics: occupancy, revenue and the order funnel. Backs
 * the MCP server (`src/mcp/`), and has no way to change data — its only
 * dependency is {@link IAnalyticsRepository}, which has no write methods.
 *
 * Days are counted in {@link BUSINESS_TIME_ZONE}: "today", "upcoming", and
 * which day an order was placed on all follow the wall clock where the
 * business runs, not UTC — otherwise an order placed at 00:30 on 1 April in
 * Madrid would count towards March.
 *
 * `now` is injectable so tests can pin "today", as {@link EventCatalog}'s
 * callers do with its `today` parameter.
 */
export class AnalyticsService {
  constructor(
    private readonly repository: IAnalyticsRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly timeZone: string = BUSINESS_TIME_ZONE
  ) {}

  /** Today's date in the business time zone, 'YYYY-MM-DD'. */
  private today(): string {
    return calendarDateIn(this.timeZone, this.now());
  }

  /**
   * Resolves an optional `from`/`to` pair into a concrete inclusive range:
   * `to` defaults to today, `from` to {@link DEFAULT_RANGE_DAYS} days ending
   * at `to`.
   *
   * @throws {InvalidDateRangeError} for a malformed date, `from` after `to`,
   *   or a range longer than {@link MAX_RANGE_DAYS} days.
   */
  resolveRange(input: { from?: string; to?: string }): DateRange {
    const to = input.to ?? this.today();
    const toDate = parseCalendarDate(to);
    const from = input.from ?? formatCalendarDate(new Date(toDate.getTime() - (DEFAULT_RANGE_DAYS - 1) * DAY_MS));
    const fromDate = parseCalendarDate(from);

    if (fromDate > toDate) {
      throw new InvalidDateRangeError(`"from" (${from}) is after "to" (${to})`);
    }
    const days = (toDate.getTime() - fromDate.getTime()) / DAY_MS + 1;
    if (days > MAX_RANGE_DAYS) {
      throw new InvalidDateRangeError(`Range is ${days} days; the maximum is ${MAX_RANGE_DAYS}`);
    }
    return { from, to, timeZone: this.timeZone };
  }

  /** Seat counts and sell-through per performance — upcoming only unless `includePast`. */
  async getPerformanceOccupancy(input: { eventId?: string; includePast?: boolean } = {}): Promise<PerformanceOccupancy[]> {
    const rows = await this.repository.getPerformanceOccupancy({
      eventId: input.eventId,
      includePast: input.includePast ?? false,
      today: this.today(),
    });
    return rows.map((row) => ({ ...row, sellThroughPercent: percent(row.soldSeats, row.totalSeats) }));
  }

  /** Revenue from completed orders in range, grouped by event (default) or performance. */
  async getRevenueSummary(input: { from?: string; to?: string; groupBy?: RevenueGroupBy } = {}): Promise<RevenueSummary> {
    const range = this.resolveRange(input);
    const groupBy = input.groupBy ?? 'event';
    const rows = await this.repository.getRevenue(range, groupBy);

    const totals = rows.reduce(
      (sum, row) => ({
        completedOrders: sum.completedOrders + row.completedOrders,
        ticketsSold: sum.ticketsSold + row.ticketsSold,
        revenueCents: sum.revenueCents + row.revenueCents,
      }),
      { completedOrders: 0, ticketsSold: 0, revenueCents: 0 }
    );
    return { range, groupBy, currency: 'EUR', totals, rows };
  }

  /** How orders created in range ended up: counts and amounts per status, plus the completion rate. */
  async getOrderFunnel(input: { from?: string; to?: string } = {}): Promise<OrderFunnel> {
    const range = this.resolveRange(input);
    const rows = await this.repository.getOrderFunnel(range);
    const byStatus = new Map(rows.map((row) => [row.status, row]));

    const statuses = ORDER_STATUSES.map((status) => byStatus.get(status) ?? { status, orders: 0, amountCents: 0 });
    const totalOrders = statuses.reduce((sum, row) => sum + row.orders, 0);
    const completed = byStatus.get('completed')?.orders ?? 0;

    return { range, currency: 'EUR', statuses, totalOrders, completionRatePercent: percent(completed, totalOrders) };
  }
}
