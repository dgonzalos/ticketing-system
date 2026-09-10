import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminCatalogRoutes } from '../../../../../src/api/routes/admin/catalog.js';
import {
  EventNotFoundError,
  PerformanceAlreadyScheduledError,
  PerformanceHasSalesError,
  PerformanceNotFoundError,
} from '../../../../../src/domain/common/errors/domain-errors.js';
import type { EventAdminService } from '../../../../../src/domain/events/event-admin.service.js';
import type { IUserRepository, User } from '../../../../../src/domain/users/user.repository.js';
import { signToken } from '../../../../../src/infrastructure/auth/jwt.js';

const JWT_SECRET = 'test-secret';

const event = { eventId: 'event-1', title: 'Hamilton', description: null, imageUrl: null };
const createdPerformance = {
  performanceId: 'perf-1',
  eventId: 'event-1',
  date: '2026-10-02',
  time: '20:00:00',
  venue: 'Orpheum Theatre',
  city: 'Seattle',
  capacity: 100,
  status: 'scheduled' as const,
};

function createMockUserRepository(): IUserRepository {
  return { create: vi.fn(), findByEmail: vi.fn(), findById: vi.fn() };
}

function adminUser(): User {
  return { id: 'user-1', email: 'admin@example.com', name: null, createdAt: new Date(), role: 'admin' };
}

function customerUser(): User {
  return { id: 'user-1', email: 'customer@example.com', name: null, createdAt: new Date(), role: 'customer' };
}

function createMockEventAdminService(): EventAdminService {
  return {
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    createPerformances: vi.fn(),
    cancelPerformance: vi.fn(),
  } as unknown as EventAdminService;
}

/**
 * Mirrors `tests/unit/api/routes/admin/require-admin.test.ts`'s setup —
 * real `fastifyJwt`, inline `authenticate`/`requireAdmin` decorators
 * byte-for-byte matching `src/index.ts` — plus the routes under test.
 */
async function buildApp(eventAdminService: EventAdminService, userRepository: IUserRepository): Promise<FastifyInstance> {
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

  app.decorate('requireAdmin', async function (request, reply) {
    const user = await userRepository.findById(request.user.userId);
    if (!user || user.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  });

  await app.register(adminCatalogRoutes, { eventAdminService });

  return app;
}

describe('admin catalog routes', () => {
  let app: FastifyInstance;
  let eventAdminService: EventAdminService;
  let userRepository: IUserRepository;

  beforeEach(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    eventAdminService = createMockEventAdminService();
    userRepository = createMockUserRepository();
    app = await buildApp(eventAdminService, userRepository);
  });

  afterEach(async () => {
    await app.close();
    delete process.env.JWT_SECRET;
  });

  function adminAuthHeader(): { authorization: string } {
    (userRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(adminUser());
    return { authorization: `Bearer ${signToken('user-1')}` };
  }

  function customerAuthHeader(): { authorization: string } {
    (userRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(customerUser());
    return { authorization: `Bearer ${signToken('user-1')}` };
  }

  describe('POST /admin/events', () => {
    it('returns 401 with no token', async () => {
      const response = await app.inject({ method: 'POST', url: '/admin/events', payload: { title: 'Hamilton' } });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 for a customer token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/events',
        headers: customerAuthHeader(),
        payload: { title: 'Hamilton' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 201 with the created event for an admin token', async () => {
      (eventAdminService.createEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(event);

      const response = await app.inject({
        method: 'POST',
        url: '/admin/events',
        headers: adminAuthHeader(),
        payload: { title: 'Hamilton' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual(event);
    });

    it('returns 400 for a malformed body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/events',
        headers: adminAuthHeader(),
        payload: { title: '' },
      });
      expect(response.statusCode).toBe(400);
      expect(eventAdminService.createEvent).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /admin/events/:eventId', () => {
    it('returns 200 with the updated event', async () => {
      const updated = { ...event, title: 'Hamilton (Revival)' };
      (eventAdminService.updateEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updated);

      const response = await app.inject({
        method: 'PATCH',
        url: '/admin/events/event-1',
        headers: adminAuthHeader(),
        payload: { title: 'Hamilton (Revival)' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(updated);
      expect(eventAdminService.updateEvent).toHaveBeenCalledWith({ eventId: 'event-1', title: 'Hamilton (Revival)' });
    });

    it('returns 404 when the event does not exist', async () => {
      (eventAdminService.updateEvent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new EventNotFoundError('missing-event')
      );

      const response = await app.inject({
        method: 'PATCH',
        url: '/admin/events/missing-event',
        headers: adminAuthHeader(),
        payload: { title: 'New Title' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 400 when the body has no fields to change', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/admin/events/event-1',
        headers: adminAuthHeader(),
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /admin/events/:eventId/performances', () => {
    const validPayload = {
      performances: [{ date: '2026-10-02', time: '20:00:00', venue: 'Orpheum Theatre', city: 'Seattle' }],
    };

    it('returns 201 with the created performances', async () => {
      (eventAdminService.createPerformances as ReturnType<typeof vi.fn>).mockResolvedValueOnce([createdPerformance]);

      const response = await app.inject({
        method: 'POST',
        url: '/admin/events/event-1/performances',
        headers: adminAuthHeader(),
        payload: validPayload,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ performances: [createdPerformance] });
    });

    it('returns 404 when the event does not exist', async () => {
      (eventAdminService.createPerformances as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new EventNotFoundError('event-1')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/admin/events/event-1/performances',
        headers: adminAuthHeader(),
        payload: validPayload,
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 409 for a duplicate performance', async () => {
      (eventAdminService.createPerformances as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new PerformanceAlreadyScheduledError('event-1', '2026-10-02', '20:00:00', 'Orpheum Theatre')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/admin/events/event-1/performances',
        headers: adminAuthHeader(),
        payload: validPayload,
      });

      expect(response.statusCode).toBe(409);
    });

    it('returns 400 for a malformed body (bad date format)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/events/event-1/performances',
        headers: adminAuthHeader(),
        payload: { performances: [{ date: 'not-a-date', time: '20:00:00', venue: 'Orpheum Theatre', city: 'Seattle' }] },
      });
      expect(response.statusCode).toBe(400);
      expect(eventAdminService.createPerformances).not.toHaveBeenCalled();
    });

    it('returns 400 when the body eventId disagrees with the path', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/events/event-1/performances',
        headers: adminAuthHeader(),
        payload: { eventId: 'event-2', ...validPayload },
      });
      expect(response.statusCode).toBe(400);
      expect(eventAdminService.createPerformances).not.toHaveBeenCalled();
    });
  });

  describe('POST /admin/performances/:performanceId/cancel', () => {
    it('returns 200 with the cancelled status', async () => {
      (eventAdminService.cancelPerformance as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/admin/performances/perf-1/cancel',
        headers: adminAuthHeader(),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ performanceId: 'perf-1', status: 'cancelled' });
    });

    it('returns 404 for an unknown performance', async () => {
      (eventAdminService.cancelPerformance as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new PerformanceNotFoundError('missing')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/admin/performances/missing/cancel',
        headers: adminAuthHeader(),
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 409 when the performance has sold seats', async () => {
      (eventAdminService.cancelPerformance as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new PerformanceHasSalesError('perf-1')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/admin/performances/perf-1/cancel',
        headers: adminAuthHeader(),
      });

      expect(response.statusCode).toBe(409);
    });

    it('returns 403 for a customer token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/performances/perf-1/cancel',
        headers: customerAuthHeader(),
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
