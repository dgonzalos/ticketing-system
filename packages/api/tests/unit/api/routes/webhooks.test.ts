import Fastify, { type FastifyInstance } from 'fastify';
import fastifyRawBody from 'fastify-raw-body';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webhooksRoutes } from '../../../../src/api/routes/webhooks.js';
import { PaymentVerificationError } from '../../../../src/domain/common/errors/domain-errors.js';
import type { IPaymentService } from '../../../../src/domain/payments/payment.service.js';

const WEBHOOK_SECRET = 'whsec_test';

function createFakeStripe() {
  return { webhooks: { constructEvent: vi.fn() } };
}

function createMockPaymentService(): IPaymentService {
  return {
    createCheckoutSession: vi.fn(),
    verifyAndCompleteSession: vi.fn(),
    expireSession: vi.fn(),
  };
}

async function buildApp(stripe: ReturnType<typeof createFakeStripe>, paymentService: IPaymentService): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(fastifyRawBody, { field: 'rawBody', global: false });
  await app.register(webhooksRoutes, { stripe: stripe as never, webhookSecret: WEBHOOK_SECRET, paymentService });
  return app;
}

describe('webhooks routes', () => {
  let app: FastifyInstance;
  let stripe: ReturnType<typeof createFakeStripe>;
  let paymentService: IPaymentService;

  beforeEach(() => {
    stripe = createFakeStripe();
    paymentService = createMockPaymentService();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 400 when the signature cannot be verified', async () => {
    stripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('invalid signature');
    });
    app = await buildApp(stripe, paymentService);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'stripe-signature': 'bad-signature', 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(response.statusCode).toBe(400);
    expect(paymentService.verifyAndCompleteSession).not.toHaveBeenCalled();
  });

  it('completes the order on checkout.session.completed', async () => {
    stripe.webhooks.constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_123', metadata: { orderId: 'order-1' } } },
    });
    app = await buildApp(stripe, paymentService);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'stripe-signature': 'valid-signature', 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(response.statusCode).toBe(200);
    expect(paymentService.verifyAndCompleteSession).toHaveBeenCalledWith('cs_test_123', 'order-1');
  });

  it('expires the order and releases seats on checkout.session.expired', async () => {
    stripe.webhooks.constructEvent.mockReturnValue({
      type: 'checkout.session.expired',
      data: { object: { id: 'cs_test_123', metadata: { orderId: 'order-1' } } },
    });
    app = await buildApp(stripe, paymentService);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'stripe-signature': 'valid-signature', 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(response.statusCode).toBe(200);
    expect(paymentService.expireSession).toHaveBeenCalledWith('order-1', 'cs_test_123');
  });

  it('acknowledges (200) rather than retries when verification fails on a completed event', async () => {
    stripe.webhooks.constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_123', metadata: { orderId: 'order-1' } } },
    });
    (paymentService.verifyAndCompleteSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new PaymentVerificationError('cs_test_123', 'order-1')
    );
    app = await buildApp(stripe, paymentService);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'stripe-signature': 'valid-signature', 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(response.statusCode).toBe(200);
  });

  it('returns 5xx (so Stripe retries) on an unexpected handler error', async () => {
    stripe.webhooks.constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_123', metadata: { orderId: 'order-1' } } },
    });
    (paymentService.verifyAndCompleteSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB unreachable'));
    app = await buildApp(stripe, paymentService);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'stripe-signature': 'valid-signature', 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(response.statusCode).toBe(500);
  });

  it('ignores event types it does not handle', async () => {
    stripe.webhooks.constructEvent.mockReturnValue({ type: 'payment_intent.created', data: { object: {} } });
    app = await buildApp(stripe, paymentService);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'stripe-signature': 'valid-signature', 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(response.statusCode).toBe(200);
    expect(paymentService.verifyAndCompleteSession).not.toHaveBeenCalled();
    expect(paymentService.expireSession).not.toHaveBeenCalled();
  });
});
