import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyRawBody from 'fastify-raw-body';
import { authRoutes } from './api/routes/auth.js';
import { eventsRoutes } from './api/routes/events.js';
import { ordersRoutes } from './api/routes/orders.js';
import { paymentsRoutes } from './api/routes/payments.js';
import { seatsRoutes } from './api/routes/seats.js';
import { webhooksRoutes } from './api/routes/webhooks.js';
import { EventCatalog } from './domain/events/event-catalog.js';
import { OrderService } from './domain/orders/order-service.js';
import { SeatLockManager } from './domain/seats/seat-lock.js';
import { UserService } from './domain/users/user-service.js';
import { db } from './infrastructure/db/client.js';
import { DrizzleEventRepository } from './infrastructure/db/drizzle-event.repository.js';
import { DrizzleOrderRepository } from './infrastructure/db/drizzle-order.repository.js';
import { DrizzleSeatRepository } from './infrastructure/db/drizzle-seat.repository.js';
import { DrizzleUserRepository } from './infrastructure/db/drizzle-user.repository.js';
import { runMigrations } from './infrastructure/db/migrate.js';
import { jwtTokenSigner } from './infrastructure/auth/jwt.js';
import { createStripeClient } from './infrastructure/payment/stripe-config.js';
import { StripePaymentService } from './infrastructure/payment/stripe-payment.service.js';


const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

const FRONTEND_URL = process.env.FRONTEND_URL;
if (!FRONTEND_URL) {
  throw new Error('FRONTEND_URL environment variable is required');
}

// Not required at startup: empty until `stripe listen` (or a configured
// production endpoint) provides one. Until then, any webhook delivery
// simply fails signature verification (400) rather than being trusted —
// it doesn't block Phase 1 testing, which never hits this route.
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';
if (!STRIPE_WEBHOOK_SECRET) {
  console.warn('⚠️  STRIPE_WEBHOOK_SECRET is not set — Stripe webhook deliveries will fail signature verification');
}

// Run migrations before starting server
await runMigrations();

const app = Fastify({
  logger: true
});

// Plugins
await app.register(helmet);
await app.register(cors, { origin: '*' });

/**
 * Raw body capture for Stripe webhook signature verification. `global:
 * false` means no route gets `request.rawBody` unless it opts in via
 * `{ config: { rawBody: true } }` (see `webhooks.ts`) — without that,
 * `request.rawBody` is `undefined` and `stripe.webhooks.constructEvent`
 * always fails.
 */
await app.register(fastifyRawBody, { field: 'rawBody', global: false });

/**
 * Auth flow:
 *  1. A token is issued via `POST /auth/signup` or `POST /auth/login` (both
 *     call `infrastructure/auth/jwt.ts`'s `signToken()` internally) as a
 *     signed HS256 JWT with payload `{ userId }`.
 *  2. Clients send it as `Authorization: Bearer <token>`.
 *  3. Protected routes add `onRequest: [app.authenticate]`.
 *  4. `authenticate` calls `request.jwtVerify()` (from `@fastify/jwt`), which
 *     verifies the signature/expiry and populates `request.user`.
 *  5. On success the handler reads `request.user.userId`. On failure,
 *     `jwtVerify()` throws and `authenticate` replies 401 before the
 *     handler runs.
 */
await app.register(fastifyJwt, {
  secret: JWT_SECRET,
  sign: { algorithm: 'HS256' },
  verify: { algorithms: ['HS256'] }
});

app.decorate('authenticate', async function (request, reply) {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ error: 'Unauthorized' });
  }
});

// Domain wiring
const seatRepository = new DrizzleSeatRepository(db);
const seatLockManager = new SeatLockManager(seatRepository);
const eventRepository = new DrizzleEventRepository(db);
const eventCatalog = new EventCatalog(eventRepository);
const orderRepository = new DrizzleOrderRepository(db);
const orderService = new OrderService(orderRepository, eventRepository);
const userRepository = new DrizzleUserRepository(db);
const userService = new UserService(userRepository, jwtTokenSigner);
const stripeClient = createStripeClient();
const paymentService = new StripePaymentService(stripeClient, orderRepository, eventRepository, FRONTEND_URL);
console.log('Stripe initialized in test mode');

/**
 * Admin authorization: looks up the caller's role live in the database on
 * every request rather than trusting a role baked into the JWT. Tokens live
 * 1h (see `infrastructure/auth/jwt.ts`'s `DEFAULT_EXPIRES_IN`) — a role in
 * the payload would mean a demoted admin keeps admin rights for up to an
 * hour. Declared here (after `userRepository` is constructed above), not
 * immediately after `app.decorate('authenticate', ...)`, since it closes
 * over `userRepository`.
 *
 * Protected routes use `onRequest: [app.authenticate, app.requireAdmin]`, in
 * that order — `request.user` doesn't exist until `authenticate` has run.
 * Replies 403 (not 401/404): the caller is authenticated, just not permitted.
 */
app.decorate('requireAdmin', async function (request, reply) {
  const user = await userRepository.findById(request.user.userId);
  if (!user || user.role !== 'admin') {
    return reply.code(403).send({ error: 'Forbidden' });
  }
});

// Routes
await app.register(seatsRoutes, { seatLockManager });
await app.register(eventsRoutes, { eventCatalog });
await app.register(ordersRoutes, { orderService });
await app.register(paymentsRoutes, { paymentService, orderService });
await app.register(webhooksRoutes, { stripe: stripeClient, webhookSecret: STRIPE_WEBHOOK_SECRET, paymentService });
await app.register(authRoutes, { userService });

// Health check
app.get('/health', async (request, reply) => {
  return { status: 'ok' };
});

// Start server
const PORT = Number(process.env.PORT) || 3000;
await app.listen({ port: PORT, host: '0.0.0.0' });

console.log(`✅ Server running on http://localhost:${PORT}`);
