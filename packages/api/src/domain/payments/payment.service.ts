import type { Order } from '../orders/order.repository.js';

export { PaymentInitiationError, PaymentVerificationError } from '../common/errors/domain-errors.js';

export interface CheckoutSessionResult {
  checkoutUrl: string;
  sessionId: string;
}

/**
 * Framework-agnostic contract for starting and settling a hosted Stripe
 * Checkout payment for an order. The domain layer depends on this interface
 * only — it must not import the Stripe SDK.
 */
export interface IPaymentService {
  /**
   * Creates a Stripe Checkout session for `order`, charging
   * `order.totalAmount` (never a caller-supplied amount — this is the
   * server-trusted total). The event name/seat count shown on Stripe's
   * hosted page are looked up internally, not supplied by the caller.
   *
   * @throws {PaymentInitiationError} if `order.status` isn't `pending` or
   * `payment_processing`, or if Stripe rejects the request.
   */
  createCheckoutSession(order: Order): Promise<CheckoutSessionResult>;

  /**
   * Verifies that `sessionId` belongs to `orderId` and was actually paid,
   * then transitions the order to `completed`.
   *
   * @throws {PaymentVerificationError} if the session isn't paid, or its
   * `metadata.orderId` doesn't match `orderId`.
   */
  verifyAndCompleteSession(sessionId: string, orderId: string): Promise<Order>;

  /**
   * Transitions `orderId` to `cancelled` and releases its seats back to
   * `available`, for an abandoned or expired Checkout session — but only if
   * `stripeSessionId` still matches the order's currently-recorded session.
   * A safe no-op for a stale/superseded session id (e.g. the buyer resumed
   * checkout with a newer session that has since completed or is still
   * live): the order and its seats are left untouched.
   */
  expireSession(orderId: string, stripeSessionId: string): Promise<void>;
}
