import type { FastifyPluginAsync } from 'fastify';
import type { PaymentSessionResponseDto, PaymentStatusResponseDto } from '@ticketing-system/shared';
import { PaymentInitiationError } from '../../domain/common/errors/domain-errors.js';
import type { IPaymentService } from '../../domain/payments/payment.service.js';
import type { OrderService } from '../../domain/orders/order-service.js';

export interface PaymentsRoutesOptions {
  paymentService: IPaymentService;
  orderService: OrderService;
}

interface OrderIdParams {
  orderId: string;
}

interface ErrorResponse {
  error: string;
}

/**
 * Whether `orderId` is well-formed enough to look up (matches `orders.ts`'s
 * own convention: server-generated UUIDs, validated loosely).
 */
function isValidOrderId(orderId: string): boolean {
  return orderId.trim().length > 0;
}

/**
 * Stripe Checkout routes: starting a hosted-Checkout payment session for an
 * order and reading back its current payment status. All business logic is
 * delegated to the injected {@link IPaymentService}/{@link OrderService} —
 * this plugin only validates input and maps domain results/errors to HTTP
 * responses.
 */
export const paymentsRoutes: FastifyPluginAsync<PaymentsRoutesOptions> = async (app, { paymentService, orderService }) => {
  /**
   * POST /orders/:orderId/payment-session
   *
   * Starts (or resumes) a hosted Stripe Checkout session for an order,
   * redirecting the buyer to `checkout.stripe.com`. Allowed from `pending`
   * (first attempt) or `payment_processing` (resuming after navigating away
   * — mints a fresh session rather than reusing a possibly-stale one).
   *
   * Auth: required (Bearer JWT, verified by `app.authenticate`).
   * Responses: 200 with `{ paymentUrl, orderId, status }`, 400 for an
   * invalid orderId or a Stripe initiation failure, 401 if unauthenticated,
   * 403 if the order belongs to a different user, 404 if it does not exist,
   * 409 if it isn't `pending`/`payment_processing`.
   */
  app.post<{ Params: OrderIdParams; Reply: PaymentSessionResponseDto | ErrorResponse }>(
    '/orders/:orderId/payment-session',
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
      if (order.status !== 'pending' && order.status !== 'payment_processing') {
        return reply.code(409).send({ error: 'Order is not awaiting payment' });
      }

      try {
        const { checkoutUrl } = await paymentService.createCheckoutSession(order);
        return reply.code(200).send({ paymentUrl: checkoutUrl, orderId, status: 'payment_processing' });
      } catch (err) {
        if (err instanceof PaymentInitiationError) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  /**
   * GET /orders/:orderId/payment-status
   *
   * Reads back an order's current status, for the frontend to poll while a
   * Stripe webhook settles payment asynchronously.
   *
   * Auth: required (Bearer JWT, verified by `app.authenticate`).
   * Responses: 200 with `{ status, totalAmount }`, 400 for an invalid
   * orderId, 401 if unauthenticated, 403 if the order belongs to a
   * different user, 404 if it does not exist.
   */
  app.get<{ Params: OrderIdParams; Reply: PaymentStatusResponseDto | ErrorResponse }>(
    '/orders/:orderId/payment-status',
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

      return reply.code(200).send({ status: order.status, totalAmount: order.totalAmount });
    }
  );
};
