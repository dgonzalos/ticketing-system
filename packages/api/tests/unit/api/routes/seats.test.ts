import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seatsRoutes } from '../../../../src/api/routes/seats.js';
import { SeatLockOwnershipError, SeatNotFoundError } from '../../../../src/domain/common/errors/domain-errors.js';
import type { SeatLockManager } from '../../../../src/domain/seats/seat-lock.js';
import { signToken } from '../../../../src/infrastructure/auth/jwt.js';

const JWT_SECRET = 'test-secret';

function createMockSeatLockManager(): SeatLockManager {
  return {
    lockSeat: vi.fn(),
    unlockSeat: vi.fn(),
    confirmSeat: vi.fn(),
    cleanupExpiredLocks: vi.fn(),
    checkAvailability: vi.fn(),
  } as unknown as SeatLockManager;
}

async function buildApp(seatLockManager: SeatLockManager): Promise<FastifyInstance> {
  const app = Fastify();

  await app.register(fastifyJwt, {
    secret: JWT_SECRET,
    sign: { algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
  });

  app.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  await app.register(seatsRoutes, { seatLockManager });

  return app;
}

describe('seats routes', () => {
  let app: FastifyInstance;
  let seatLockManager: SeatLockManager;

  beforeEach(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    seatLockManager = createMockSeatLockManager();
    app = await buildApp(seatLockManager);
  });

  afterEach(async () => {
    await app.close();
    delete process.env.JWT_SECRET;
  });

  function authHeader(userId = 'user-1'): { authorization: string } {
    return { authorization: `Bearer ${signToken(userId)}` };
  }

  describe('auth', () => {
    it('returns 401 with no Authorization header', async () => {
      const response = await app.inject({ method: 'POST', url: '/seats/seat-A12/select' });
      expect(response.statusCode).toBe(401);
    });

    it('returns 401 with a garbage token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/seats/seat-A12/select',
        headers: { authorization: 'Bearer not-a-jwt' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('accepts a token signed via infrastructure/auth/jwt.ts', async () => {
      (seatLockManager.lockSeat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: true,
        expiresAt: new Date('2026-01-01T00:05:00.000Z'),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/seats/seat-A12/select',
        headers: authHeader('user-1'),
      });

      expect(response.statusCode).toBe(200);
      expect(seatLockManager.lockSeat).toHaveBeenCalledWith('seat-A12', 'user-1');
    });
  });

  describe('POST /seats/:seatId/select', () => {
    it('returns 200 on success', async () => {
      const expiresAt = new Date('2026-01-01T00:05:00.000Z');
      (seatLockManager.lockSeat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true, expiresAt });

      const response = await app.inject({
        method: 'POST',
        url: '/seats/seat-A12/select',
        headers: authHeader(),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true, expiresAt: expiresAt.toISOString(), seatId: 'seat-A12' });
    });

    it('returns 409 when the seat is already reserved by someone else', async () => {
      const expiresAt = new Date('2026-01-01T00:05:00.000Z');
      (seatLockManager.lockSeat as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: false, expiresAt });

      const response = await app.inject({
        method: 'POST',
        url: '/seats/seat-A12/select',
        headers: authHeader(),
      });

      expect(response.statusCode).toBe(409);
    });

    it('returns 404 when the seat does not exist', async () => {
      (seatLockManager.lockSeat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new SeatNotFoundError('seat-ghost'));

      const response = await app.inject({
        method: 'POST',
        url: '/seats/seat-ghost/select',
        headers: authHeader(),
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 400 for an invalid seatId without calling lockSeat', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/seats/%20/select',
        headers: authHeader(),
      });

      expect(response.statusCode).toBe(400);
      expect(seatLockManager.lockSeat).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /seats/:seatId/select', () => {
    it('returns 200 on success', async () => {
      (seatLockManager.unlockSeat as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: '/seats/seat-A12/select',
        headers: authHeader(),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
    });

    it('returns 404 when the seat does not exist', async () => {
      (seatLockManager.unlockSeat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new SeatNotFoundError('seat-ghost'));

      const response = await app.inject({
        method: 'DELETE',
        url: '/seats/seat-ghost/select',
        headers: authHeader(),
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 403 when the seat is not held by the caller', async () => {
      (seatLockManager.unlockSeat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new SeatLockOwnershipError('seat-A12', 'user-1')
      );

      const response = await app.inject({
        method: 'DELETE',
        url: '/seats/seat-A12/select',
        headers: authHeader(),
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /seats/check-availability', () => {
    it('returns 200 with no Authorization header', async () => {
      (seatLockManager.checkAvailability as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ 'seat-A12': true });

      const response = await app.inject({
        method: 'POST',
        url: '/seats/check-availability',
        payload: { seatIds: ['seat-A12'] },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ 'seat-A12': true });
      expect(seatLockManager.checkAvailability).toHaveBeenCalledWith(['seat-A12']);
    });

    it('returns 400 for a missing seatIds field', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/seats/check-availability',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(seatLockManager.checkAvailability).not.toHaveBeenCalled();
    });

    it('returns 400 for an empty seatIds array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/seats/check-availability',
        payload: { seatIds: [] },
      });

      expect(response.statusCode).toBe(400);
      expect(seatLockManager.checkAvailability).not.toHaveBeenCalled();
    });
  });
});
