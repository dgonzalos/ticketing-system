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
}
