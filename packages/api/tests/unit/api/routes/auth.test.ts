import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authRoutes } from '../../../../src/api/routes/auth.js';
import { verifyToken } from '../../../../src/infrastructure/auth/jwt.js';

describe('auth routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-secret';
    app = Fastify();
    await app.register(authRoutes);
  });

  afterEach(async () => {
    await app.close();
    delete process.env.JWT_SECRET;
  });

  describe('POST /auth/dev-token', () => {
    it('returns a token that verifies back to the given userId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/dev-token',
        payload: { userId: 'user-1' },
      });

      expect(response.statusCode).toBe(200);
      const { token } = response.json();
      expect(verifyToken(token)).toEqual({ userId: 'user-1' });
    });

    it('returns 400 for a missing userId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/dev-token',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for an empty userId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/dev-token',
        payload: { userId: '' },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
