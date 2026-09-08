/** A single seat within an order, with its price snapshotted at purchase time. */
export interface OrderItem {
  seatId: string;
  /** Price in cents, snapshotted from the seat at the moment of purchase. */
  price: number;
}

/** Lifecycle state of an order. */
export type OrderStatus = 'pending' | 'payment_processing' | 'completed' | 'cancelled';

/** A confirmed purchase of one or more seats for a single performance. */
export interface Order {
  orderId: string;
  userId: string;
  email: string;
  performanceId: string;
  status: OrderStatus;
  /** Total charged, in cents. */
  totalAmount: number;
  items: OrderItem[];
  createdAt: Date;
  /** Stripe Checkout Session id for this order's most recent payment attempt, if any. */
  stripeSessionId?: string | null;
}

/** Input required to place an order. */
export interface CreateOrderInput {
  userId: string;
  email: string;
  performanceId: string;
  seatIds: string[];
  /** Total the client believes it's paying, in cents — checked against the server-recalculated total. */
  expectedTotalAmount: number;
}

/**
 * Framework-agnostic persistence contract for order creation and lookup.
 *
 * `createOrder` must be atomic: locking the seats, validating them, writing
 * the order + its items, and marking the seats sold all happen in one
 * transaction, so an order can never be created without its seats actually
 * being sold (or vice versa). The domain layer depends on this interface
 * only — it must not import a specific database driver or ORM.
 */
export interface IOrderRepository {
  /**
   * Atomically locks `input.seatIds`, validates each is reserved by
   * `input.userId` and not expired, recalculates the total from current
   * seat prices, and — only if everything checks out — creates the order
   * and its items and marks the seats sold.
   *
   * @throws {OrderSeatNotFoundError} if any seat does not exist or does not
   * belong to `input.performanceId`.
   * @throws {OrderSeatOwnershipError} if any seat is not reserved by
   * `input.userId`.
   * @throws {OrderSeatConflictError} if any seat is not `reserved`, or its
   * reservation has expired.
   * @throws {OrderPriceMismatchError} if the recalculated total does not
   * match `input.expectedTotalAmount`.
   */
  createOrder(input: CreateOrderInput): Promise<Order>;

  /** Reads a single order (with its items), or null if it does not exist. */
  findOrderById(orderId: string): Promise<Order | null>;

  /**
   * Atomically transitions an order from `fromStatus` to `toStatus`,
   * guarded by a `WHERE status = fromStatus` clause so a concurrent
   * transition can't be silently clobbered.
   *
   * @returns the updated order, or `null` if no row matched — either the
   * order doesn't exist, or its status was no longer `fromStatus`.
   */
  updateOrderStatus(orderId: string, fromStatus: OrderStatus, toStatus: OrderStatus): Promise<Order | null>;

  /**
   * Atomically records a new Stripe Checkout session for an order and
   * transitions it to `payment_processing`, guarded by `WHERE status =
   * fromStatus` (same shape as {@link updateOrderStatus}) — a single write
   * rather than two, so a crash between "session recorded" and "status
   * advanced" can't happen. `fromStatus` is `pending` on a first attempt or
   * `payment_processing` on a resume (a same-status guarded write that
   * still records the new session id).
   *
   * @returns the updated order, or `null` if no row matched — either the
   * order doesn't exist, or its status was no longer `fromStatus`.
   */
  recordStripeSessionAndAdvance(orderId: string, fromStatus: OrderStatus, stripeSessionId: string): Promise<Order | null>;

  /**
   * Atomically transitions an order from `payment_processing` to
   * `cancelled`, guarded by both `WHERE status = 'payment_processing'` *and*
   * `stripe_session_id = expectedStripeSessionId`. Used to make a Stripe
   * `checkout.session.expired` event a safe no-op when the order has since
   * moved on to a different (resumed) Checkout session — an expiry for a
   * superseded session id must never cancel an order that's actually
   * progressing on a newer one.
   *
   * @returns the updated order, or `null` if no row matched — either the
   * order doesn't exist, its status was no longer `payment_processing`, or
   * `expectedStripeSessionId` no longer matches the order's current session.
   */
  cancelIfCurrentSession(orderId: string, expectedStripeSessionId: string): Promise<Order | null>;

  /**
   * Reverts every seat belonging to this order from `sold` back to
   * `available`. Called when an order's payment is cancelled/expired —
   * seats are marked `sold` at order-creation time (not on payment
   * completion), so there is no separate "lock" to release; this is the
   * only way they become purchasable by someone else again.
   */
  releaseSeatsForOrder(orderId: string): Promise<void>;
}
