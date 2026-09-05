import { index, integer, pgEnum, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { performancesTable } from './performances.js';
import { seatsTable } from './seats.js';

/**
 * Lifecycle state of an order.
 *
 * `pending` (just created) -> `payment_processing` -> `completed`, or
 * `cancelled` from any pre-`completed` state. Only `pending` is reachable
 * today — the later states are reserved for the Phase 2 payment
 * integration behind the confirmation screen's "Continue to Payment"
 * placeholder.
 */
export const orderStatusEnum = pgEnum('order_status', ['pending', 'payment_processing', 'completed', 'cancelled']);

/**
 * A confirmed purchase of one or more seats for a single performance.
 *
 * Created atomically alongside its `orderItemsTable` rows and the seats it
 * covers being marked `sold` — see `DrizzleOrderRepository.createOrder`,
 * which does all three in one transaction so an order can never exist
 * without its seats actually being sold (or vice versa).
 */
export const ordersTable = pgTable(
  'orders',
  {
    /** Stable order identifier (UUID), generated at creation time. */
    id: text('id').primaryKey(),

    /**
     * Identifier of the user who placed the order. There is no `users`
     * table yet (see `seats.reservedBy` for the same convention) — this is
     * an opaque string taken from the JWT payload, not a foreign key.
     */
    userId: text('user_id').notNull(),

    /** Contact email captured at checkout, for order notifications. */
    email: varchar('email', { length: 255 }).notNull(),

    /** The performance these seats belong to. */
    performanceId: text('performance_id')
      .notNull()
      .references(() => performancesTable.id),

    /** Current lifecycle state — see the enum doc above. */
    status: orderStatusEnum('status').default('pending').notNull(),

    /** Total charged, in cents — recalculated server-side from seat prices, never trusted from the client. */
    totalAmount: integer('total_amount').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index('orders_user_id_idx').on(table.userId),
    performanceIdIdx: index('orders_performance_id_idx').on(table.performanceId),
  })
);

/**
 * A single seat within an order, with its price snapshotted at purchase
 * time — `seats.price` can't be used for historical order totals since it
 * reflects the seat's *current* price, not what was actually charged.
 */
export const orderItemsTable = pgTable(
  'order_items',
  {
    id: serial('id').primaryKey(),

    orderId: text('order_id')
      .notNull()
      .references(() => ordersTable.id),

    seatId: text('seat_id')
      .notNull()
      .references(() => seatsTable.id),

    /** Price in cents, snapshotted from the seat at the moment of purchase. */
    price: integer('price').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orderIdIdx: index('order_items_order_id_idx').on(table.orderId),
  })
);

/** An order row as read from the database. */
export type Order = typeof ordersTable.$inferSelect;

/** Shape required to insert a new order row. */
export type NewOrder = typeof ordersTable.$inferInsert;

/** An order item row as read from the database. */
export type OrderItem = typeof orderItemsTable.$inferSelect;

/** Shape required to insert a new order item row. */
export type NewOrderItem = typeof orderItemsTable.$inferInsert;

/** The set of valid order `status` values. */
export type OrderStatus = (typeof orderStatusEnum.enumValues)[number];
