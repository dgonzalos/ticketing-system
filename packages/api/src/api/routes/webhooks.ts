import type { FastifyPluginAsync } from 'fastify';
import type Stripe from 'stripe';
import { PaymentVerificationError } from '../../domain/common/errors/domain-errors.js';
import type { IPaymentService } from '../../domain/payments/payment.service.js';

export interface WebhooksRoutesOptions {
  stripe: Stripe;
  webhookSecret: string;
  paymentService: IPaymentService;
}

/**
 * Stripe webhook receiver: the source of truth for actually completing or
 * cancelling a payment (the client-facing routes in `payments.ts` only ever
 * start a Checkout session or poll status — they never mark an order paid
 * themselves).
 *
 * Response codes matter here beyond just "success/failure": Stripe retries
 * a delivery on anything outside 2xx.
 * - An unverifiable signature is 400 — a forged/corrupt payload, retrying
 *   won't help and it must never be treated as a real event.
 * - A verified event that's handled (including a safe no-op, e.g. a
 *   duplicate delivery of an already-processed event) is 200.
 * - An unexpected failure while handling a verified event is 5xx, so
 *   Stripe's automatic retry actually kicks in instead of the event being
 *   silently dropped forever.
 */
export const webhooksRoutes: FastifyPluginAsync<WebhooksRoutesOptions> = async (app, { stripe, webhookSecret, paymentService }) => {
  app.post(
    '/webhooks/stripe',
    { config: { rawBody: true } },
    async (request, reply) => {
      const signature = request.headers['stripe-signature'];
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(request.rawBody as string, signature as string, webhookSecret);
      } catch (err) {
        request.log.warn({ err }, 'Stripe webhook signature verification failed');
        return reply.code(400).send({ error: 'Invalid signature' });
      }

      try {
        switch (event.type) {
          case 'checkout.session.completed': {
            const session = event.data.object as Stripe.Checkout.Session;
            const orderId = session.metadata?.orderId;
            if (!orderId) {
              request.log.warn({ sessionId: session.id }, 'checkout.session.completed with no orderId in metadata');
              break;
            }
            await paymentService.verifyAndCompleteSession(session.id, orderId);
            break;
          }
          case 'checkout.session.expired': {
            const session = event.data.object as Stripe.Checkout.Session;
            const orderId = session.metadata?.orderId;
            if (!orderId) {
              request.log.warn({ sessionId: session.id }, 'checkout.session.expired with no orderId in metadata');
              break;
            }
            await paymentService.expireSession(orderId, session.id);
            break;
          }
          default:
            // Other event types aren't relevant to this integration.
            break;
        }
      } catch (err) {
        if (err instanceof PaymentVerificationError) {
          // Not a transient failure — retrying won't make the session any
          // more verifiable, so acknowledge it rather than have Stripe
          // retry forever.
          request.log.warn({ err }, 'Stripe webhook: payment verification failed');
          return reply.code(200).send({ received: true });
        }
        request.log.error({ err }, 'Stripe webhook handler failed unexpectedly');
        return reply.code(500).send({ error: 'Webhook handler failed' });
      }

      return reply.code(200).send({ received: true });
    }
  );
};
