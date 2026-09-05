import type { FastifyPluginAsync } from 'fastify';
import { z, ZodError } from 'zod';
import type { CreateOrderRequestDto, OrderDto } from '@ticketing-system/shared';
import {
  OrderPriceMismatchError,
  OrderSeatConflictError,
  OrderSeatNotFoundError,
  OrderSeatOwnershipError,
  PerformanceNotFoundError,
} from '../../domain/common/errors/domain-errors.js';
import type { Order, OrderService } from '../../domain/orders/order-service.js';

export interface OrdersRoutesOptions {
  orderService: OrderService;
}

interface OrderIdParams {
  orderId: string;
}

interface ErrorResponse {
  error: string;
}

function toOrderResponse(order: Order): OrderDto {
  return {
    id: order.orderId,
    userId: order.userId,
    email: order.email,
    performanceId: order.performanceId,
    status: order.status,
    totalAmount: order.totalAmount,
    items: order.items,
    createdAt: order.createdAt.toISOString(),
    paymentRequired: true,
  };
}

const createOrderBodySchema = z.object({
  performanceId: z.string().min(1),
  seatIds: z
    .array(z.string().min(1))
    .min(1)
    .refine((seatIds) => new Set(seatIds).size === seatIds.length, { message: 'seatIds must not contain duplicates' }),
  totalAmount: z.number().int().positive(),
  email: z.string().email(),
});
type CreateOrderBody = z.infer<typeof createOrderBodySchema>;

/**
 * Whether `orderId` is well-formed enough to look up. Order ids are
 * server-generated UUIDs, but validation is deliberately loose (matching
 * the seats/events routes' convention): non-empty after trimming.
 */
function isValidOrderId(orderId: string): boolean {
  return orderId.trim().length > 0;
}

/**
 * Checkout routes: placing an order (atomically converting reserved seats
 * into a sale) and reading back an order for the confirmation screen. All
 * business logic is delegated to the injected {@link OrderService} — this
 * plugin only validates input and maps domain results/errors to HTTP
 * responses.
 */
export const ordersRoutes: FastifyPluginAsync<OrdersRoutesOptions> = async (app, { orderService }) => {
  /**
   * POST /orders
   *
   * Places an order for the authenticated user: locks the given seats,
   * recalculates the total from current seat prices, and — only if
   * everything checks out — creates the order and marks the seats sold, all
   * in one atomic transaction.
   *
   * Auth: required (Bearer JWT, verified by `app.authenticate`).
   * Body: `{ performanceId, seatIds, totalAmount, email }` (see
   * `CreateOrderRequestDto`).
   * Responses: 201 with the created order, 400 for a malformed body or a
   * price mismatch, 401 if unauthenticated, 403 if a seat is reserved by a
   * different user, 404 if the performance or a seat does not exist, 409 if
   * a seat is no longer available (already sold, or its reservation
   * expired).
   */
  app.post<{ Body: CreateOrderRequestDto; Reply: OrderDto | ErrorResponse }>(
    '/orders',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      let body: CreateOrderBody;
      try {
        body = createOrderBodySchema.parse(request.body);
      } catch (err) {
        if (err instanceof ZodError) {
          return reply.code(400).send({ error: 'Invalid request body' });
        }
        throw err;
      }

      const userId = request.user.userId;

      try {
        const order = await orderService.createOrder({
          userId,
          email: body.email,
          performanceId: body.performanceId,
          seatIds: body.seatIds,
          expectedTotalAmount: body.totalAmount,
        });
        return reply.code(201).send(toOrderResponse(order));
      } catch (err) {
        if (err instanceof PerformanceNotFoundError || err instanceof OrderSeatNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        if (err instanceof OrderPriceMismatchError) {
          return reply.code(400).send({ error: err.message });
        }
        if (err instanceof OrderSeatOwnershipError) {
          return reply.code(403).send({ error: err.message });
        }
        if (err instanceof OrderSeatConflictError) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  /**
   * GET /orders/:orderId
   *
   * Reads back an order, for the order confirmation screen.
   *
   * Auth: required (Bearer JWT, verified by `app.authenticate`).
   * Responses: 200 with the order, 400 for an invalid orderId, 401 if
   * unauthenticated, 403 if the order belongs to a different user, 404 if
   * it does not exist.
   */
  app.get<{ Params: OrderIdParams; Reply: OrderDto | ErrorResponse }>(
    '/orders/:orderId',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { orderId } = request.params;
      if (!isValidOrderId(orderId)) {
        return reply.code(400).send({ error: 'Invalid orderId' });
      }

      const order = await orderService.findOrderById(orderId);
      if (!order) {
        return reply.code(404).send({ error: `Order not found: ${orderId}` });
      }
      if (order.userId !== request.user.userId) {
        return reply.code(403).send({ error: 'This order belongs to a different user' });
      }

      return reply.code(200).send(toOrderResponse(order));
    }
  );
};
