import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import { seatsRoutes } from './api/routes/seats.js';
import { SeatLockManager } from './domain/seats/seat-lock.js';
import { db } from './infrastructure/db/client.js';
import { DrizzleSeatRepository } from './infrastructure/db/drizzle-seat.repository.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

const app = Fastify({
  logger: true
});

// Plugins
await app.register(helmet);
await app.register(cors, { origin: '*' });

/**
 * Auth flow:
 *  1. A token is issued out-of-band (e.g. via `infrastructure/auth/jwt.ts`'s
 *     `signToken()`, or a future login route) as a signed HS256 JWT with
 *     payload `{ userId }`.
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

// Routes
await app.register(seatsRoutes, { seatLockManager });

// Health check
app.get('/health', async (request, reply) => {
  return { status: 'ok' };
});

// Start server
const PORT = Number(process.env.PORT) || 3000;
await app.listen({ port: PORT, host: '0.0.0.0' });

console.log(`✅ Server running on http://localhost:${PORT}`);
