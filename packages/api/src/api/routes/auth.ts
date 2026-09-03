import type { FastifyPluginAsync } from 'fastify';
import { z, ZodError } from 'zod';
import { signToken } from '../../infrastructure/auth/jwt.js';

const devTokenBodySchema = z.object({
  userId: z.string().min(1),
});

interface DevTokenResponse {
  token: string;
}

interface ErrorResponse {
  error: string;
}

/**
 * Development-only auth routes.
 *
 * There is no login/credential system yet — `POST /auth/dev-token` mints a
 * valid JWT for *any* `userId` you hand it, no password or session check.
 * It exists purely to unblock frontend/manual testing of JWT-gated seat
 * routes. `src/index.ts` only registers this plugin when
 * `ENABLE_DEV_AUTH_ROUTES=true` is explicitly set — it must never be
 * reachable in a real deployment.
 */
export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Reply: DevTokenResponse | ErrorResponse }>('/auth/dev-token', async (request, reply) => {
    let body: { userId: string };
    try {
      body = devTokenBodySchema.parse(request.body);
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({ error: 'Invalid request body' });
      }
      throw err;
    }

    return reply.code(200).send({ token: signToken(body.userId) });
  });
};
