import { PerformanceNotFoundError } from '../common/errors/domain-errors.js';
import type { IEventRepository } from '../events/event.repository.js';
import type { CreateOrderInput, IOrderRepository, Order } from './order.repository.js';

export type { CreateOrderInput, Order, OrderItem, OrderStatus } from './order.repository.js';

/**
 * Orchestrates checkout: verifies the performance exists, then delegates
 * the atomic seat-locking/order-creation transaction to the injected
 * {@link IOrderRepository}. This class has no knowledge of the database,
 * ORM, or web framework in use.
 */
export class OrderService {
  constructor(private readonly orderRepository: IOrderRepository, private readonly eventRepository: IEventRepository) {}

  /**
   * Places an order for `input.seatIds`.
   *
   * @throws {PerformanceNotFoundError} if `input.performanceId` does not exist.
   * @throws {OrderSeatNotFoundError} if any seat does not exist or does not
   * belong to the performance.
   * @throws {OrderSeatOwnershipError} if any seat is not reserved by the
   * purchasing user.
   * @throws {OrderSeatConflictError} if any seat is not currently
   * purchasable (not reserved, or its reservation has expired).
   * @throws {OrderPriceMismatchError} if the recalculated total doesn't
   * match `input.expectedTotalAmount`.
   */
  async createOrder(input: CreateOrderInput): Promise<Order> {
    const performance = await this.eventRepository.findPerformanceById(input.performanceId);
    if (!performance) {
      throw new PerformanceNotFoundError(input.performanceId);
    }

    return this.orderRepository.createOrder(input);
  }

  /** Reads a single order, or null if it does not exist. */
  async findOrderById(orderId: string): Promise<Order | null> {
    return this.orderRepository.findOrderById(orderId);
  }

  /**
   * Starts the (placeholder) payment flow for a `pending` order: transitions
   * it to `payment_processing` and returns a mock payment URL. In Phase 2
   * this is where a real provider (Stripe/PayPal) checkout session gets
   * created and its real hosted URL returned instead.
   *
   * @returns `null` if the order doesn't exist or isn't `pending`.
   */
  async initiatePayment(orderId: string): Promise<{ order: Order; paymentUrl: string } | null> {
    const order = await this.orderRepository.updateOrderStatus(orderId, 'pending', 'payment_processing');
    if (!order) {
      return null;
    }
    return { order, paymentUrl: `/order/${orderId}/payment` };
  }

  /**
   * Completes the (placeholder) payment flow: transitions an order from
   * `payment_processing` to `completed`. Idempotent — calling it again on an
   * already-`completed` order returns that order unchanged rather than
   * erroring, so a retried/duplicated confirmation can't double-process.
   *
   * @returns `null` if the order doesn't exist or isn't `payment_processing`
   * (and isn't already `completed`).
   */
  async completePayment(orderId: string): Promise<Order | null> {
    const updated = await this.orderRepository.updateOrderStatus(orderId, 'payment_processing', 'completed');
    if (updated) {
      return updated;
    }

    // The atomic transition above didn't apply. That's either a genuine
    // conflict (order doesn't exist / isn't payment_processing) or a
    // concurrent confirm-payment call already completed it a moment ago —
    // re-checking here (rather than checking completed-ness up front) keeps
    // the idempotent case race-free: whichever caller loses the atomic
    // update still sees the other's committed result instead of a false 409.
    const existing = await this.orderRepository.findOrderById(orderId);
    return existing?.status === 'completed' ? existing : null;
  }
}
