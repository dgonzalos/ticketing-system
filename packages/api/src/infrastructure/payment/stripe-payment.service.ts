import type Stripe from 'stripe';
import { PaymentInitiationError, PaymentVerificationError } from '../../domain/common/errors/domain-errors.js';
import type { IEventRepository } from '../../domain/events/event.repository.js';
import type { IOrderRepository, Order } from '../../domain/orders/order.repository.js';
import type { CheckoutSessionResult, IPaymentService } from '../../domain/payments/payment.service.js';

/**
 * Stripe-backed implementation of {@link IPaymentService}, using hosted
 * Stripe Checkout (a redirect to `checkout.stripe.com`) rather than
 * embedded Stripe Elements — card details never touch this app's own pages.
 */
export class StripePaymentService implements IPaymentService {
  constructor(
    private readonly stripe: Stripe,
    private readonly orderRepository: IOrderRepository,
    private readonly eventRepository: IEventRepository,
    private readonly frontendUrl: string
  ) {}

  async createCheckoutSession(order: Order): Promise<CheckoutSessionResult> {
    if (order.status !== 'pending' && order.status !== 'payment_processing') {
      throw new PaymentInitiationError(order.orderId);
    }

    // Resuming: reuse the order's existing Checkout session while it's
    // still open, instead of always minting a fresh one. Without this, a
    // buyer with two open tabs (or a double-submit) could end up with two
    // simultaneously live Checkout sessions for the same order and pay
    // through both — Stripe would capture two real charges with nothing to
    // reconcile them. Reusing means at most one session is ever live at a
    // time for a given order.
    const reusable = await this.findReusableSession(order.stripeSessionId);
    if (reusable?.url) {
      return { checkoutUrl: reusable.url, sessionId: reusable.id };
    }

    const performance = await this.eventRepository.findPerformanceById(order.performanceId);
    const event = performance ? await this.eventRepository.findEventById(performance.eventId) : null;
    const eventName = event?.title ?? 'Ticketing order';
    const seatCount = order.items.length;

    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'eur',
              unit_amount: order.totalAmount,
              product_data: {
                name: `Event: ${eventName}`,
                description: `${seatCount} seat${seatCount === 1 ? '' : 's'}`,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: order.email,
        success_url: `${this.frontendUrl}/order/${order.orderId}/payment?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${this.frontendUrl}/order/${order.orderId}?cancelled=true`,
        metadata: { orderId: order.orderId, userId: order.userId },
      });
    } catch (err) {
      throw new PaymentInitiationError(order.orderId, err);
    }

    if (!session.url) {
      throw new PaymentInitiationError(order.orderId);
    }

    // A single guarded write recording the new session id and advancing
    // status together — a same-status no-op when `order.status` is already
    // `payment_processing` (resuming), or the real pending -> processing
    // transition on a first attempt. One write rather than two means a
    // crash can't leave a session id recorded with the order still stuck
    // `pending` (which would make the webhook's own guarded
    // `payment_processing -> completed` transition never match).
    const updated = await this.orderRepository.recordStripeSessionAndAdvance(order.orderId, order.status, session.id);
    if (!updated) {
      // The order's status changed between the check at the top of this
      // method and this write (e.g. a concurrent call already advanced or
      // completed it) — the session was created on Stripe's side but can't
      // be attached to this order anymore.
      throw new PaymentInitiationError(order.orderId);
    }

    return { checkoutUrl: session.url, sessionId: session.id };
  }

  /**
   * Looks up `stripeSessionId` on Stripe and returns it only if it's still
   * `open` (payable). Returns `null` if there's no recorded session, it no
   * longer exists, or it's already `complete`/`expired` — any of which
   * means a fresh session should be created instead.
   */
  private async findReusableSession(stripeSessionId: string | null | undefined): Promise<Stripe.Checkout.Session | null> {
    if (!stripeSessionId) {
      return null;
    }
    try {
      const session = await this.stripe.checkout.sessions.retrieve(stripeSessionId);
      return session.status === 'open' ? session : null;
    } catch {
      return null;
    }
  }

  async verifyAndCompleteSession(sessionId: string, orderId: string): Promise<Order> {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid' || session.metadata?.orderId !== orderId) {
      throw new PaymentVerificationError(sessionId, orderId);
    }

    const completed = await this.orderRepository.updateOrderStatus(orderId, 'payment_processing', 'completed');
    if (completed) {
      return completed;
    }

    // The guarded transition didn't apply — either a genuine conflict, or a
    // concurrent delivery of the same webhook event already completed it a
    // moment ago. Re-checking keeps duplicate deliveries idempotent instead
    // of surfacing a false failure.
    const existing = await this.orderRepository.findOrderById(orderId);
    if (existing?.status === 'completed') {
      return existing;
    }
    throw new PaymentVerificationError(sessionId, orderId);
  }

  async expireSession(orderId: string, stripeSessionId: string): Promise<void> {
    const cancelled = await this.orderRepository.cancelIfCurrentSession(orderId, stripeSessionId);
    if (!cancelled) {
      // The order has moved on since this session was created — either a
      // resumed session already completed it, or a newer session is still
      // live. Either way, this expiry no longer applies; releasing seats
      // here would undo a payment or cancel a checkout still in progress.
      return;
    }
    await this.orderRepository.releaseSeatsForOrder(orderId);
  }
}
