import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  OrderPriceMismatchError,
  OrderSeatConflictError,
  OrderSeatNotFoundError,
  OrderSeatOwnershipError,
} from '../../domain/common/errors/domain-errors.js';
import type {
  CreateOrderInput,
  IOrderRepository,
  Order,
  OrderStatus,
  OrderSummary,
} from '../../domain/orders/order.repository.js';
import { isActiveReservation, lockSeatsForUpdate, markSeatsSold, type DbTransaction, type SeatRow } from './seat-queries.js';
import * as schema from './schema/index.js';

type OrderRow = typeof schema.ordersTable.$inferSelect;
type OrderItemRow = typeof schema.orderItemsTable.$inferSelect;

/**
 * Sales tax applied on top of seat prices. Must match
 * `packages/web/src/screens/CheckoutScreen/CheckoutScreen.tsx`'s own
 * `TAX_RATE` constant — this can't live in `@ticketing-system/shared`
 * since that package is types-only with no runtime build step (see its
 * top-of-file doc comment), so it's a small, deliberately duplicated
 * literal here instead.
 */
const TAX_RATE = 0.1;

/** Most recent orders returned by `listOrderSummariesByUser` (see its contract in `order.repository.ts`). */
const ORDER_SUMMARY_LIMIT = 50;

/**
 * Validates that every locked seat is purchasable by `userId` for
 * `performanceId`, throwing the first violation found. Called while the
 * seats are held under `SELECT ... FOR UPDATE`, so nothing can change
 * between this check and the writes that follow it in the same
 * transaction.
 */
function assertSeatsPurchasable(rows: SeatRow[], seatIds: string[], performanceId: string, userId: string, now: Date): void {
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  for (const seatId of seatIds) {
    const row = rowsById.get(seatId);
    if (!row || row.performanceId !== performanceId) {
      throw new OrderSeatNotFoundError(seatId);
    }
    if (row.status !== 'reserved') {
      throw new OrderSeatConflictError(seatId);
    }
    if (row.reservedBy !== userId) {
      throw new OrderSeatOwnershipError(seatId, userId);
    }
    if (!isActiveReservation(row, now)) {
      throw new OrderSeatConflictError(seatId);
    }
  }
}

function toOrder(orderRow: OrderRow, itemRows: OrderItemRow[]): Order {
  return {
    orderId: orderRow.id,
    userId: orderRow.userId,
    email: orderRow.email,
    performanceId: orderRow.performanceId,
    status: orderRow.status as OrderStatus,
    totalAmount: orderRow.totalAmount,
    items: itemRows.map((item) => ({ seatId: item.seatId, price: item.price })),
    createdAt: orderRow.createdAt,
    stripeSessionId: orderRow.stripeSessionId,
  };
}

/**
 * Drizzle/PostgreSQL implementation of {@link IOrderRepository}. Places the
 * entire checkout — locking seats, validating them, writing the order and
 * its items, and marking the seats sold — inside a single transaction, so
 * it either fully commits or fully rolls back.
 */
export class DrizzleOrderRepository implements IOrderRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const { userId, email, performanceId, seatIds, expectedTotalAmount } = input;

    return this.db.transaction(async (tx: DbTransaction) => {
      const now = new Date();
      const seatRows = await lockSeatsForUpdate(tx, seatIds);

      assertSeatsPurchasable(seatRows, seatIds, performanceId, userId, now);

      const seatsById = new Map(seatRows.map((row) => [row.id, row]));
      const subtotal = seatIds.reduce((sum, seatId) => sum + seatsById.get(seatId)!.price, 0);
      const tax = Math.round(subtotal * TAX_RATE);
      const recalculatedTotal = subtotal + tax;

      if (recalculatedTotal !== expectedTotalAmount) {
        throw new OrderPriceMismatchError(recalculatedTotal, expectedTotalAmount);
      }

      const [orderRow] = await tx
        .insert(schema.ordersTable)
        .values({ id: randomUUID(), userId, email, performanceId, status: 'pending', totalAmount: recalculatedTotal })
        .returning();

      const itemRows = await tx
        .insert(schema.orderItemsTable)
        .values(seatIds.map((seatId) => ({ orderId: orderRow.id, seatId, price: seatsById.get(seatId)!.price })))
        .returning();

      await markSeatsSold(tx, seatIds);

      return toOrder(orderRow, itemRows);
    });
  }

  async findOrderById(orderId: string): Promise<Order | null> {
    // A single left join, not two sequential selects: this is the read path
    // behind the order-confirmation screen, so it shouldn't pay two round
    // trips for one order.
    const rows = await this.db
      .select({ order: schema.ordersTable, item: schema.orderItemsTable })
      .from(schema.ordersTable)
      .leftJoin(schema.orderItemsTable, eq(schema.orderItemsTable.orderId, schema.ordersTable.id))
      .where(eq(schema.ordersTable.id, orderId));

    const orderRow = rows[0]?.order;
    if (!orderRow) {
      return null;
    }

    const itemRows = rows.flatMap((row) => (row.item ? [row.item] : []));

    return toOrder(orderRow, itemRows);
  }

  async listOrderSummariesByUser(userId: string): Promise<OrderSummary[]> {
    const o = schema.ordersTable;
    const p = schema.performancesTable;
    const e = schema.eventsTable;
    const i = schema.orderItemsTable;
    const s = schema.seatsTable;

    // One aggregate query for the whole page, not one per order. Date/time
    // are formatted as text in SQL, as in DrizzleEventRepository's
    // summaries, so node-postgres doesn't turn a `date` into a JS Date.
    const rows = await this.db
      .select({
        orderId: o.id,
        status: o.status,
        totalAmount: o.totalAmount,
        createdAt: o.createdAt,
        seatLabels: sql<string[]>`coalesce(array_agg(${s.row} || ${s.number} order by ${s.row}, ${s.number}) filter (where ${s.id} is not null), '{}')`,
        eventId: e.id,
        eventTitle: e.title,
        performanceId: p.id,
        date: sql<string>`to_char(${p.date}, 'YYYY-MM-DD')`,
        time: sql<string>`${p.time}::text`,
        venue: p.venue,
        city: p.city,
      })
      .from(o)
      .innerJoin(p, eq(p.id, o.performanceId))
      .innerJoin(e, eq(e.id, p.eventId))
      .leftJoin(i, eq(i.orderId, o.id))
      .leftJoin(s, eq(s.id, i.seatId))
      .where(eq(o.userId, userId))
      .groupBy(o.id, p.id, e.id)
      .orderBy(desc(o.createdAt))
      .limit(ORDER_SUMMARY_LIMIT);

    return rows.map((row) => ({
      orderId: row.orderId,
      status: row.status as OrderStatus,
      totalAmount: row.totalAmount,
      createdAt: row.createdAt,
      seatLabels: row.seatLabels,
      event: { eventId: row.eventId, title: row.eventTitle },
      performance: { performanceId: row.performanceId, date: row.date, time: row.time, venue: row.venue, city: row.city },
    }));
  }

  async updateOrderStatus(orderId: string, fromStatus: OrderStatus, toStatus: OrderStatus): Promise<Order | null> {
    const [orderRow] = await this.db
      .update(schema.ordersTable)
      .set({ status: toStatus, updatedAt: new Date() })
      .where(and(eq(schema.ordersTable.id, orderId), eq(schema.ordersTable.status, fromStatus)))
      .returning();

    if (!orderRow) {
      return null;
    }

    const itemRows = await this.db.select().from(schema.orderItemsTable).where(eq(schema.orderItemsTable.orderId, orderId));

    return toOrder(orderRow, itemRows);
  }

  async recordStripeSessionAndAdvance(orderId: string, fromStatus: OrderStatus, stripeSessionId: string): Promise<Order | null> {
    const [orderRow] = await this.db
      .update(schema.ordersTable)
      .set({ stripeSessionId, status: 'payment_processing', updatedAt: new Date() })
      .where(and(eq(schema.ordersTable.id, orderId), eq(schema.ordersTable.status, fromStatus)))
      .returning();

    if (!orderRow) {
      return null;
    }

    const itemRows = await this.db.select().from(schema.orderItemsTable).where(eq(schema.orderItemsTable.orderId, orderId));

    return toOrder(orderRow, itemRows);
  }

  async cancelIfCurrentSession(orderId: string, expectedStripeSessionId: string): Promise<Order | null> {
    const [orderRow] = await this.db
      .update(schema.ordersTable)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(schema.ordersTable.id, orderId),
          eq(schema.ordersTable.status, 'payment_processing'),
          eq(schema.ordersTable.stripeSessionId, expectedStripeSessionId)
        )
      )
      .returning();

    if (!orderRow) {
      return null;
    }

    const itemRows = await this.db.select().from(schema.orderItemsTable).where(eq(schema.orderItemsTable.orderId, orderId));

    return toOrder(orderRow, itemRows);
  }

  async releaseSeatsForOrder(orderId: string): Promise<void> {
    await this.db.transaction(async (tx: DbTransaction) => {
      const items = await tx
        .select({ seatId: schema.orderItemsTable.seatId })
        .from(schema.orderItemsTable)
        .where(eq(schema.orderItemsTable.orderId, orderId));

      const seatIds = items.map((item) => item.seatId);
      if (seatIds.length === 0) {
        return;
      }

      await tx
        .update(schema.seatsTable)
        .set({ status: 'available', reservedUntil: null, reservedBy: null, updatedAt: new Date() })
        .where(and(inArray(schema.seatsTable.id, seatIds), eq(schema.seatsTable.status, 'sold')));
    });
  }
}
