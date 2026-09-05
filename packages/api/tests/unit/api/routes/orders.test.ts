import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ordersRoutes } from '../../../../src/api/routes/orders.js';
import {
  OrderPriceMismatchError,
  OrderSeatConflictError,
  OrderSeatNotFoundError,
  OrderSeatOwnershipError,
  PerformanceNotFoundError,
} from '../../../../src/domain/common/errors/domain-errors.js';
import type { OrderService } from '../../../../src/domain/orders/order-service.js';
import { signToken } from '../../../../src/infrastructure/auth/jwt.js';

const JWT_SECRET = 'test-secret';

const order = {
  orderId: 'order-1',
  userId: 'user-1',
  email: 'buyer@example.com',
  performanceId: 'perf-1',
  status: 'pending' as const,
  totalAmount: 33000,
  items: [
    { seatId: 'seat-A12', price: 15000 },
    { seatId: 'seat-A13', price: 15000 },
  ],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

function createMockOrderService(): OrderService {
  return {
    createOrder: vi.fn(),
    findOrderById: vi.fn(),
  } as unknown as OrderService;
}

async function buildApp(orderService: OrderService): Promise<FastifyInstance> {
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

  await app.register(ordersRoutes, { orderService });

  return app;
}

describe('orders routes', () => {
  let app: FastifyInstance;
  let orderService: OrderService;

  beforeEach(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    orderService = createMockOrderService();
    app = await buildApp(orderService);
  });

  afterEach(async () => {
    await app.close();
    delete process.env.JWT_SECRET;
  });

  function authHeader(userId = 'user-1'): { authorization: string } {
    return { authorization: `Bearer ${signToken(userId)}` };
  }

  const validBody = {
    performanceId: 'perf-1',
    seatIds: ['seat-A12', 'seat-A13'],
    totalAmount: 33000,
    email: 'buyer@example.com',
  };

  describe('POST /orders', () => {
    it('returns 401 with no Authorization header', async () => {
      const response = await app.inject({ method: 'POST', url: '/orders', payload: validBody });
      expect(response.statusCode).toBe(401);
      expect(orderService.createOrder).not.toHaveBeenCalled();
    });

    it('returns 201 with the created order on success', async () => {
      (orderService.createOrder as ReturnType<typeof vi.fn>).mockResolvedValueOnce(order);

      const response = await app.inject({
        method: 'POST',
        url: '/orders',
        headers: authHeader('user-1'),
        payload: validBody,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({
        id: 'order-1',
        userId: 'user-1',
        email: 'buyer@example.com',
        performanceId: 'perf-1',
        status: 'pending',
        totalAmount: 33000,
        items: [
          { seatId: 'seat-A12', price: 15000 },
          { seatId: 'seat-A13', price: 15000 },
        ],
        createdAt: order.createdAt.toISOString(),
        paymentRequired: true,
      });
      expect(orderService.createOrder).toHaveBeenCalledWith({
        userId: 'user-1',
        email: 'buyer@example.com',
        performanceId: 'perf-1',
        seatIds: ['seat-A12', 'seat-A13'],
        expectedTotalAmount: 33000,
      });
    });

    it('returns 400 for a malformed body without calling the service', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/orders',
        headers: authHeader(),
        payload: { performanceId: 'perf-1', seatIds: [], totalAmount: 33000, email: 'buyer@example.com' },
      });

      expect(response.statusCode).toBe(400);
      expect(orderService.createOrder).not.toHaveBeenCalled();
    });

    it('returns 400 for duplicate seatIds without calling the service', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/orders',
        headers: authHeader(),
        payload: { ...validBody, seatIds: ['seat-A12', 'seat-A12'] },
      });

      expect(response.statusCode).toBe(400);
      expect(orderService.createOrder).not.toHaveBeenCalled();
    });

    it('returns 400 for an invalid email without calling the service', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/orders',
        headers: authHeader(),
        payload: { ...validBody, email: 'not-an-email' },
      });

      expect(response.statusCode).toBe(400);
      expect(orderService.createOrder).not.toHaveBeenCalled();
    });

    it('returns 400 on a price mismatch', async () => {
      (orderService.createOrder as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new OrderPriceMismatchError(30000, 33000)
      );

      const response = await app.inject({
        method: 'POST',
        url: '/orders',
        headers: authHeader(),
        payload: validBody,
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 when the performance does not exist', async () => {
      (orderService.createOrder as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new PerformanceNotFoundError('perf-1')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/orders',
        headers: authHeader(),
        payload: validBody,
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 when a seat does not exist', async () => {
      (orderService.createOrder as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new OrderSeatNotFoundError('seat-A12')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/orders',
        headers: authHeader(),
        payload: validBody,
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 403 when a seat is reserved by a different user', async () => {
      (orderService.createOrder as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new OrderSeatOwnershipError('seat-A12', 'user-1')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/orders',
        headers: authHeader(),
        payload: validBody,
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns 409 when a seat is no longer available', async () => {
      (orderService.createOrder as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new OrderSeatConflictError('seat-A12')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/orders',
        headers: authHeader(),
        payload: validBody,
      });

      expect(response.statusCode).toBe(409);
    });
  });

  describe('GET /orders/:orderId', () => {
    it('returns 401 with no Authorization header', async () => {
      const response = await app.inject({ method: 'GET', url: '/orders/order-1' });
      expect(response.statusCode).toBe(401);
    });

    it('returns 200 with the order on success', async () => {
      (orderService.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(order);

      const response = await app.inject({
        method: 'GET',
        url: '/orders/order-1',
        headers: authHeader('user-1'),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe('order-1');
    });

    it('returns 404 when the order does not exist', async () => {
      (orderService.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'GET',
        url: '/orders/order-ghost',
        headers: authHeader('user-1'),
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 403 when the order belongs to a different user', async () => {
      (orderService.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(order);

      const response = await app.inject({
        method: 'GET',
        url: '/orders/order-1',
        headers: authHeader('user-2'),
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns 400 for a whitespace-only orderId without calling the service', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/orders/%20',
        headers: authHeader(),
      });

      expect(response.statusCode).toBe(400);
      expect(orderService.findOrderById).not.toHaveBeenCalled();
    });
  });
});
