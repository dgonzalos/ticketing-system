import { describe, expect, it, vi } from 'vitest';
import { PerformanceNotFoundError } from '../../../../src/domain/common/errors/domain-errors.js';
import type { IEventRepository, Performance } from '../../../../src/domain/events/event.repository.js';
import { OrderService } from '../../../../src/domain/orders/order-service.js';
import type { CreateOrderInput, IOrderRepository, Order } from '../../../../src/domain/orders/order.repository.js';

function createMockOrderRepository(): IOrderRepository {
  return {
    createOrder: vi.fn(),
    findOrderById: vi.fn(),
    updateOrderStatus: vi.fn(),
  };
}

function createMockEventRepository(): IEventRepository {
  return {
    listEvents: vi.fn(),
    findEventById: vi.fn(),
    listPerformancesByEvent: vi.fn(),
    findPerformanceById: vi.fn(),
  };
}

const performance: Performance = {
  performanceId: 'perf-1',
  eventId: 'event-1',
  date: '2026-03-14',
  time: '19:30:00',
  venue: 'Orpheum Theatre',
  city: 'Seattle',
  capacity: 100,
};

const input: CreateOrderInput = {
  userId: 'user-1',
  email: 'buyer@example.com',
  performanceId: 'perf-1',
  seatIds: ['seat-A12', 'seat-A13'],
  expectedTotalAmount: 33000,
};

const order: Order = {
  orderId: 'order-1',
  userId: 'user-1',
  email: 'buyer@example.com',
  performanceId: 'perf-1',
  status: 'pending',
  totalAmount: 33000,
  items: [
    { seatId: 'seat-A12', price: 15000 },
    { seatId: 'seat-A13', price: 15000 },
  ],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('OrderService', () => {
  it('creates an order once the performance is confirmed to exist', async () => {
    const orderRepository = createMockOrderRepository();
    const eventRepository = createMockEventRepository();
    (eventRepository.findPerformanceById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(performance);
    (orderRepository.createOrder as ReturnType<typeof vi.fn>).mockResolvedValueOnce(order);
    const service = new OrderService(orderRepository, eventRepository);

    await expect(service.createOrder(input)).resolves.toEqual(order);
    expect(orderRepository.createOrder).toHaveBeenCalledWith(input);
  });

  it('throws PerformanceNotFoundError without attempting to create the order', async () => {
    const orderRepository = createMockOrderRepository();
    const eventRepository = createMockEventRepository();
    (eventRepository.findPerformanceById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const service = new OrderService(orderRepository, eventRepository);

    const error = await service.createOrder(input).catch((e) => e);

    expect(error).toBeInstanceOf(PerformanceNotFoundError);
    expect((error as PerformanceNotFoundError).performanceId).toBe('perf-1');
    expect(orderRepository.createOrder).not.toHaveBeenCalled();
  });

  it('propagates domain errors thrown by the order repository (e.g. price mismatch, seat conflict)', async () => {
    /**
     * The repository owns the atomic locking/validation transaction and
     * throws the specific domain error (price mismatch, ownership,
     * conflict, not-found) — the service must not swallow or reinterpret
     * it, just let it surface to the route layer.
     */
    const orderRepository = createMockOrderRepository();
    const eventRepository = createMockEventRepository();
    (eventRepository.findPerformanceById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(performance);
    const repositoryError = new Error('seat conflict');
    (orderRepository.createOrder as ReturnType<typeof vi.fn>).mockRejectedValueOnce(repositoryError);
    const service = new OrderService(orderRepository, eventRepository);

    await expect(service.createOrder(input)).rejects.toBe(repositoryError);
  });

  it('finds an order by id', async () => {
    const orderRepository = createMockOrderRepository();
    const eventRepository = createMockEventRepository();
    (orderRepository.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(order);
    const service = new OrderService(orderRepository, eventRepository);

    await expect(service.findOrderById('order-1')).resolves.toEqual(order);
  });

  it('returns null when an order does not exist', async () => {
    const orderRepository = createMockOrderRepository();
    const eventRepository = createMockEventRepository();
    (orderRepository.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const service = new OrderService(orderRepository, eventRepository);

    await expect(service.findOrderById('order-ghost')).resolves.toBeNull();
  });

  describe('initiatePayment', () => {
    it('transitions a pending order to payment_processing and returns a mock payment URL', async () => {
      const orderRepository = createMockOrderRepository();
      const eventRepository = createMockEventRepository();
      const processingOrder: Order = { ...order, status: 'payment_processing' };
      (orderRepository.updateOrderStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(processingOrder);
      const service = new OrderService(orderRepository, eventRepository);

      await expect(service.initiatePayment('order-1')).resolves.toEqual({
        order: processingOrder,
        paymentUrl: '/order/order-1/payment',
      });
      expect(orderRepository.updateOrderStatus).toHaveBeenCalledWith('order-1', 'pending', 'payment_processing');
    });

    it('returns null when the order is not pending (or does not exist)', async () => {
      const orderRepository = createMockOrderRepository();
      const eventRepository = createMockEventRepository();
      (orderRepository.updateOrderStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      const service = new OrderService(orderRepository, eventRepository);

      await expect(service.initiatePayment('order-1')).resolves.toBeNull();
    });
  });

  describe('completePayment', () => {
    it('transitions a payment_processing order to completed without an extra lookup', async () => {
      const orderRepository = createMockOrderRepository();
      const eventRepository = createMockEventRepository();
      const completedOrder: Order = { ...order, status: 'completed' };
      (orderRepository.updateOrderStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(completedOrder);
      const service = new OrderService(orderRepository, eventRepository);

      await expect(service.completePayment('order-1')).resolves.toEqual(completedOrder);
      expect(orderRepository.updateOrderStatus).toHaveBeenCalledWith('order-1', 'payment_processing', 'completed');
      // The atomic update succeeded on the first try, so there's no reason
      // to pay for a second round trip re-reading the order.
      expect(orderRepository.findOrderById).not.toHaveBeenCalled();
    });

    it('is idempotent: falls back to the existing order when a concurrent call already completed it', async () => {
      const orderRepository = createMockOrderRepository();
      const eventRepository = createMockEventRepository();
      const completedOrder: Order = { ...order, status: 'completed' };
      // Simulates losing a race to a concurrent completePayment call: the
      // atomic transition finds no matching row (status is no longer
      // payment_processing), so this call re-checks and finds it already
      // completed rather than surfacing a false conflict.
      (orderRepository.updateOrderStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      (orderRepository.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(completedOrder);
      const service = new OrderService(orderRepository, eventRepository);

      await expect(service.completePayment('order-1')).resolves.toEqual(completedOrder);
    });

    it('returns null when the order is not payment_processing (and not completed)', async () => {
      const orderRepository = createMockOrderRepository();
      const eventRepository = createMockEventRepository();
      (orderRepository.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(order); // status: 'pending'
      (orderRepository.updateOrderStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      const service = new OrderService(orderRepository, eventRepository);

      await expect(service.completePayment('order-1')).resolves.toBeNull();
    });
  });
});
