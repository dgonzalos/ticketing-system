import { describe, expect, it, vi } from 'vitest';
import { PaymentInitiationError, PaymentVerificationError } from '../../../src/domain/common/errors/domain-errors.js';
import type { IEventRepository, Performance, Event } from '../../../src/domain/events/event.repository.js';
import type { IOrderRepository, Order } from '../../../src/domain/orders/order.repository.js';
import { StripePaymentService } from '../../../src/infrastructure/payment/stripe-payment.service.js';

const FRONTEND_URL = 'http://localhost:5173';

function createFakeStripe() {
  return {
    checkout: {
      sessions: {
        create: vi.fn(),
        retrieve: vi.fn(),
      },
    },
  };
}

function createMockOrderRepository(): IOrderRepository {
  return {
    createOrder: vi.fn(),
    findOrderById: vi.fn(),
    updateOrderStatus: vi.fn(),
    recordStripeSessionAndAdvance: vi.fn(),
    releaseSeatsForOrder: vi.fn(),
    cancelIfCurrentSession: vi.fn(),
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
  status: 'scheduled',
};

const event: Event = { eventId: 'event-1', title: 'Hamilton', description: null, imageUrl: null };

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

describe('StripePaymentService', () => {
  describe('createCheckoutSession', () => {
    it('creates a Stripe session for a pending order and records its id', async () => {
      const stripe = createFakeStripe();
      const orderRepository = createMockOrderRepository();
      const eventRepository = createMockEventRepository();
      (eventRepository.findPerformanceById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(performance);
      (eventRepository.findEventById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(event);
      stripe.checkout.sessions.create.mockResolvedValueOnce({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/c/pay/cs_test_123',
      });
      (orderRepository.recordStripeSessionAndAdvance as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ...order,
        status: 'payment_processing',
        stripeSessionId: 'cs_test_123',
      });
      const service = new StripePaymentService(stripe as never, orderRepository, eventRepository, FRONTEND_URL);

      const result = await service.createCheckoutSession(order);

      expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123', sessionId: 'cs_test_123' });
      expect(orderRepository.recordStripeSessionAndAdvance).toHaveBeenCalledWith('order-1', 'pending', 'cs_test_123');

      const call = stripe.checkout.sessions.create.mock.calls[0][0];
      expect(call.mode).toBe('payment');
      expect(call.line_items[0].price_data.currency).toBe('eur');
      expect(call.line_items[0].price_data.unit_amount).toBe(33000);
      expect(call.customer_email).toBe('buyer@example.com');
      expect(call.metadata).toEqual({ orderId: 'order-1', userId: 'user-1' });
      expect(call.success_url).toContain('/order/order-1/payment?session_id={CHECKOUT_SESSION_ID}');
      expect(call.cancel_url).toContain('/order/order-1?cancelled=true');
    });

    it('allows re-creating a session for an order already in payment_processing (resume)', async () => {
      const stripe = createFakeStripe();
      const orderRepository = createMockOrderRepository();
      const eventRepository = createMockEventRepository();
      (eventRepository.findPerformanceById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(performance);
      (eventRepository.findEventById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(event);
      stripe.checkout.sessions.create.mockResolvedValueOnce({ id: 'cs_test_456', url: 'https://checkout.stripe.com/c/pay/cs_test_456' });
      (orderRepository.recordStripeSessionAndAdvance as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ...order,
        status: 'payment_processing',
        stripeSessionId: 'cs_test_456',
      });
      const service = new StripePaymentService(stripe as never, orderRepository, eventRepository, FRONTEND_URL);

      const result = await service.createCheckoutSession({ ...order, status: 'payment_processing' });

      expect(result.sessionId).toBe('cs_test_456');
      // Same-status guarded write — a no-op status-wise that still records
      // the new session id, rather than requiring a separate code path.
      expect(orderRepository.recordStripeSessionAndAdvance).toHaveBeenCalledWith('order-1', 'payment_processing', 'cs_test_456');
    });

    it('reuses the order\'s existing session instead of creating a new one while it is still open', async () => {
      const stripe = createFakeStripe();
      const orderRepository = createMockOrderRepository();
      const eventRepository = createMockEventRepository();
      stripe.checkout.sessions.retrieve.mockResolvedValueOnce({
        id: 'cs_existing',
        url: 'https://checkout.stripe.com/c/pay/cs_existing',
        status: 'open',
      });
      const service = new StripePaymentService(stripe as never, orderRepository, eventRepository, FRONTEND_URL);

      const result = await service.createCheckoutSession({ ...order, status: 'payment_processing', stripeSessionId: 'cs_existing' });

      expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_existing', sessionId: 'cs_existing' });
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
      expect(orderRepository.recordStripeSessionAndAdvance).not.toHaveBeenCalled();
    });

    it('creates a fresh session when the recorded one is no longer open (completed/expired)', async () => {
      const stripe = createFakeStripe();
      const orderRepository = createMockOrderRepository();
      const eventRepository = createMockEventRepository();
      (eventRepository.findPerformanceById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(performance);
      (eventRepository.findEventById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(event);
      stripe.checkout.sessions.retrieve.mockResolvedValueOnce({ id: 'cs_old', status: 'expired' });
      stripe.checkout.sessions.create.mockResolvedValueOnce({ id: 'cs_new', url: 'https://checkout.stripe.com/c/pay/cs_new' });
      (orderRepository.recordStripeSessionAndAdvance as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ...order,
        status: 'payment_processing',
        stripeSessionId: 'cs_new',
      });
      const service = new StripePaymentService(stripe as never, orderRepository, eventRepository, FRONTEND_URL);

      const result = await service.createCheckoutSession({ ...order, status: 'payment_processing', stripeSessionId: 'cs_old' });

      expect(result.sessionId).toBe('cs_new');
      expect(orderRepository.recordStripeSessionAndAdvance).toHaveBeenCalledWith('order-1', 'payment_processing', 'cs_new');
    });

    it('creates a fresh session when the recorded session id no longer resolves on Stripe', async () => {
      const stripe = createFakeStripe();
      const orderRepository = createMockOrderRepository();
      const eventRepository = createMockEventRepository();
      (eventRepository.findPerformanceById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(performance);
      (eventRepository.findEventById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(event);
      stripe.checkout.sessions.retrieve.mockRejectedValueOnce(new Error('No such checkout session'));
      stripe.checkout.sessions.create.mockResolvedValueOnce({ id: 'cs_new', url: 'https://checkout.stripe.com/c/pay/cs_new' });
      (orderRepository.recordStripeSessionAndAdvance as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ...order,
        status: 'payment_processing',
        stripeSessionId: 'cs_new',
      });
      const service = new StripePaymentService(stripe as never, orderRepository, eventRepository, FRONTEND_URL);

      const result = await service.createCheckoutSession({ ...order, status: 'payment_processing', stripeSessionId: 'cs_gone' });

      expect(result.sessionId).toBe('cs_new');
    });

    it('throws PaymentInitiationError when the order status changed before the guarded session write applied', async () => {
      const stripe = createFakeStripe();
      const orderRepository = createMockOrderRepository();
      const eventRepository = createMockEventRepository();
      (eventRepository.findPerformanceById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(performance);
      (eventRepository.findEventById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(event);
      stripe.checkout.sessions.create.mockResolvedValueOnce({ id: 'cs_test_789', url: 'https://checkout.stripe.com/c/pay/cs_test_789' });
      (orderRepository.recordStripeSessionAndAdvance as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      const service = new StripePaymentService(stripe as never, orderRepository, eventRepository, FRONTEND_URL);

      await expect(service.createCheckoutSession(order)).rejects.toBeInstanceOf(PaymentInitiationError);
    });

    it('throws PaymentInitiationError for a non-pending, non-processing order', async () => {
      const stripe = createFakeStripe();
      const orderRepository = createMockOrderRepository();
      const eventRepository = createMockEventRepository();
      const service = new StripePaymentService(stripe as never, orderRepository, eventRepository, FRONTEND_URL);

      await expect(service.createCheckoutSession({ ...order, status: 'completed' })).rejects.toBeInstanceOf(
        PaymentInitiationError
      );
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('throws PaymentInitiationError when Stripe rejects the request', async () => {
      const stripe = createFakeStripe();
      const orderRepository = createMockOrderRepository();
      const eventRepository = createMockEventRepository();
      (eventRepository.findPerformanceById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(performance);
      (eventRepository.findEventById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(event);
      stripe.checkout.sessions.create.mockRejectedValueOnce(new Error('Stripe API error'));
      const service = new StripePaymentService(stripe as never, orderRepository, eventRepository, FRONTEND_URL);

      await expect(service.createCheckoutSession(order)).rejects.toBeInstanceOf(PaymentInitiationError);
    });
  });

  describe('verifyAndCompleteSession', () => {
    it('completes the order when the session is paid and metadata matches', async () => {
      const stripe = createFakeStripe();
      const orderRepository = createMockOrderRepository();
      const eventRepository = createMockEventRepository();
      stripe.checkout.sessions.retrieve.mockResolvedValueOnce({
        id: 'cs_test_123',
        payment_status: 'paid',
        metadata: { orderId: 'order-1' },
      });
      const completedOrder: Order = { ...order, status: 'completed' };
      (orderRepository.updateOrderStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(completedOrder);
      const service = new StripePaymentService(stripe as never, orderRepository, eventRepository, FRONTEND_URL);

      await expect(service.verifyAndCompleteSession('cs_test_123', 'order-1')).resolves.toEqual(completedOrder);
      expect(orderRepository.updateOrderStatus).toHaveBeenCalledWith('order-1', 'payment_processing', 'completed');
    });

    it('throws PaymentVerificationError when the session is not paid', async () => {
      const stripe = createFakeStripe();
      const orderRepository = createMockOrderRepository();
      const eventRepository = createMockEventRepository();
      stripe.checkout.sessions.retrieve.mockResolvedValueOnce({
        id: 'cs_test_123',
        payment_status: 'unpaid',
        metadata: { orderId: 'order-1' },
      });
      const service = new StripePaymentService(stripe as never, orderRepository, eventRepository, FRONTEND_URL);

      await expect(service.verifyAndCompleteSession('cs_test_123', 'order-1')).rejects.toBeInstanceOf(
        PaymentVerificationError
      );
      expect(orderRepository.updateOrderStatus).not.toHaveBeenCalled();
    });

    it('throws PaymentVerificationError when the session metadata orderId does not match', async () => {
      const stripe = createFakeStripe();
      const orderRepository = createMockOrderRepository();
      const eventRepository = createMockEventRepository();
      stripe.checkout.sessions.retrieve.mockResolvedValueOnce({
        id: 'cs_test_123',
        payment_status: 'paid',
        metadata: { orderId: 'order-other' },
      });
      const service = new StripePaymentService(stripe as never, orderRepository, eventRepository, FRONTEND_URL);

      await expect(service.verifyAndCompleteSession('cs_test_123', 'order-1')).rejects.toBeInstanceOf(
        PaymentVerificationError
      );
    });

    it('is idempotent: a duplicate delivery that loses the guarded transition still resolves if already completed', async () => {
      const stripe = createFakeStripe();
      const orderRepository = createMockOrderRepository();
      const eventRepository = createMockEventRepository();
      stripe.checkout.sessions.retrieve.mockResolvedValueOnce({
        id: 'cs_test_123',
        payment_status: 'paid',
        metadata: { orderId: 'order-1' },
      });
      const completedOrder: Order = { ...order, status: 'completed' };
      (orderRepository.updateOrderStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      (orderRepository.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(completedOrder);
      const service = new StripePaymentService(stripe as never, orderRepository, eventRepository, FRONTEND_URL);

      await expect(service.verifyAndCompleteSession('cs_test_123', 'order-1')).resolves.toEqual(completedOrder);
    });
  });

  describe('expireSession', () => {
    it('cancels the order and releases its seats when the expiring session is still current', async () => {
      const stripe = createFakeStripe();
      const orderRepository = createMockOrderRepository();
      const eventRepository = createMockEventRepository();
      const cancelledOrder: Order = { ...order, status: 'cancelled' };
      (orderRepository.cancelIfCurrentSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(cancelledOrder);
      const service = new StripePaymentService(stripe as never, orderRepository, eventRepository, FRONTEND_URL);

      await service.expireSession('order-1', 'cs_test_123');

      expect(orderRepository.cancelIfCurrentSession).toHaveBeenCalledWith('order-1', 'cs_test_123');
      expect(orderRepository.releaseSeatsForOrder).toHaveBeenCalledWith('order-1');
    });

    it('does not release seats when the expiring session has been superseded (e.g. the buyer resumed checkout with a newer session)', async () => {
      const stripe = createFakeStripe();
      const orderRepository = createMockOrderRepository();
      const eventRepository = createMockEventRepository();
      (orderRepository.cancelIfCurrentSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      const service = new StripePaymentService(stripe as never, orderRepository, eventRepository, FRONTEND_URL);

      await service.expireSession('order-1', 'cs_stale_session');

      expect(orderRepository.cancelIfCurrentSession).toHaveBeenCalledWith('order-1', 'cs_stale_session');
      expect(orderRepository.releaseSeatsForOrder).not.toHaveBeenCalled();
    });
  });
});
