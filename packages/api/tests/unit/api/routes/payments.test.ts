import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { paymentsRoutes } from '../../../../src/api/routes/payments.js';
import { PaymentInitiationError } from '../../../../src/domain/common/errors/domain-errors.js';
import type { OrderService } from '../../../../src/domain/orders/order-service.js';
import type { IPaymentService } from '../../../../src/domain/payments/payment.service.js';
import { signToken } from '../../../../src/infrastructure/auth/jwt.js';

const JWT_SECRET = 'test-secret';

const order = {
  orderId: 'order-1',
  userId: 'user-1',
  email: 'buyer@example.com',
  performanceId: 'perf-1',
  status: 'pending' as const,
  totalAmount: 33000,
  items: [{ seatId: 'seat-A12', price: 15000 }],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

function createMockOrderService(): OrderService {
  return {
    createOrder: vi.fn(),
    findOrderById: vi.fn(),
  } as unknown as OrderService;
}

function createMockPaymentService(): IPaymentService {
  return {
    createCheckoutSession: vi.fn(),
    verifyAndCompleteSession: vi.fn(),
    expireSession: vi.fn(),
  };
}

async function buildApp(paymentService: IPaymentService, orderService: OrderService): Promise<FastifyInstance> {
  const app = Fastify();

  await app.register(fastifyJwt, {
    secret: JWT_SECRET,
    sign: { algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
  });

  app.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  await app.register(paymentsRoutes, { paymentService, orderService });

  return app;
}

describe('payments routes', () => {
  let app: FastifyInstance;
  let paymentService: IPaymentService;
  let orderService: OrderService;

  beforeEach(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    paymentService = createMockPaymentService();
    orderService = createMockOrderService();
    app = await buildApp(paymentService, orderService);
  });

  afterEach(async () => {
    await app.close();
    delete process.env.JWT_SECRET;
  });

  function authHeader(userId = 'user-1'): { authorization: string } {
    return { authorization: `Bearer ${signToken(userId)}` };
  }

  describe('POST /orders/:orderId/payment-session', () => {
    it('returns 401 with no Authorization header', async () => {
      const response = await app.inject({ method: 'POST', url: '/orders/order-1/payment-session' });
      expect(response.statusCode).toBe(401);
      expect(paymentService.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('returns 404 when the order does not exist', async () => {
      (orderService.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'POST',
        url: '/orders/order-ghost/payment-session',
        headers: authHeader(),
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 403 when the order belongs to a different user', async () => {
      (orderService.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(order);

      const response = await app.inject({
        method: 'POST',
        url: '/orders/order-1/payment-session',
        headers: authHeader('user-2'),
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns 409 when the order is completed', async () => {
      (orderService.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ...order, status: 'completed' });

      const response = await app.inject({
        method: 'POST',
        url: '/orders/order-1/payment-session',
        headers: authHeader('user-1'),
      });

      expect(response.statusCode).toBe(409);
      expect(paymentService.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('returns 200 with a real checkout URL for a pending order', async () => {
      (orderService.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(order);
      (paymentService.createCheckoutSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
        sessionId: 'cs_test_123',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/orders/order-1/payment-session',
        headers: authHeader('user-1'),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        paymentUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
        orderId: 'order-1',
        status: 'payment_processing',
      });
    });

    it('allows resuming a payment_processing order (mints a fresh session)', async () => {
      (orderService.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ...order, status: 'payment_processing' });
      (paymentService.createCheckoutSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_456',
        sessionId: 'cs_test_456',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/orders/order-1/payment-session',
        headers: authHeader('user-1'),
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 400 when Stripe session creation fails', async () => {
      (orderService.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(order);
      (paymentService.createCheckoutSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new PaymentInitiationError('order-1')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/orders/order-1/payment-session',
        headers: authHeader('user-1'),
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /orders/:orderId/payment-status', () => {
    it('returns 401 with no Authorization header', async () => {
      const response = await app.inject({ method: 'GET', url: '/orders/order-1/payment-status' });
      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when the order does not exist', async () => {
      (orderService.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'GET',
        url: '/orders/order-ghost/payment-status',
        headers: authHeader(),
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 403 when the order belongs to a different user', async () => {
      (orderService.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(order);

      const response = await app.inject({
        method: 'GET',
        url: '/orders/order-1/payment-status',
        headers: authHeader('user-2'),
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns the order status and total', async () => {
      (orderService.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ...order, status: 'payment_processing' });

      const response = await app.inject({
        method: 'GET',
        url: '/orders/order-1/payment-status',
        headers: authHeader('user-1'),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'payment_processing', totalAmount: 33000 });
    });
  });
});
