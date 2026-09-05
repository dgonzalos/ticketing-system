import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  OrderPriceMismatchError,
  OrderSeatConflictError,
  OrderSeatNotFoundError,
  OrderSeatOwnershipError,
} from '../../domain/common/errors/domain-errors.js';
import type { CreateOrderInput, IOrderRepository, Order, OrderStatus } from '../../domain/orders/order.repository.js';
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
}
