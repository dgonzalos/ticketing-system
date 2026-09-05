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
}
