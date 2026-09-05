import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventsRoutes } from '../../../../src/api/routes/events.js';
import { EventNotFoundError } from '../../../../src/domain/common/errors/domain-errors.js';
import type { EventCatalog } from '../../../../src/domain/events/event-catalog.js';

function createMockEventCatalog(): EventCatalog {
  return {
    listEvents: vi.fn(),
    listPerformancesByEvent: vi.fn(),
  } as unknown as EventCatalog;
}

async function buildApp(eventCatalog: EventCatalog): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(eventsRoutes, { eventCatalog });
  return app;
}

describe('events routes', () => {
  let app: FastifyInstance;
  let eventCatalog: EventCatalog;

  beforeEach(async () => {
    eventCatalog = createMockEventCatalog();
    app = await buildApp(eventCatalog);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /events', () => {
    it('returns 200 with the event list, no auth required', async () => {
      (eventCatalog.listEvents as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { eventId: 'event-1', title: 'Hamilton', description: null, imageUrl: null },
      ]);

      const response = await app.inject({ method: 'GET', url: '/events' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([{ eventId: 'event-1', title: 'Hamilton', description: null, imageUrl: null }]);
    });
  });

  describe('GET /events/:eventId/performances', () => {
    it('returns 200 with the performance list', async () => {
      const performance = {
        performanceId: 'perf-1',
        eventId: 'event-1',
        date: '2026-03-14',
        time: '19:30:00',
        venue: 'Orpheum Theatre',
        city: 'Seattle',
        capacity: 100,
      };
      (eventCatalog.listPerformancesByEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce([performance]);

      const response = await app.inject({ method: 'GET', url: '/events/event-1/performances' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([performance]);
      expect(eventCatalog.listPerformancesByEvent).toHaveBeenCalledWith('event-1');
    });

    it('returns 404 when the event does not exist', async () => {
      (eventCatalog.listPerformancesByEvent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new EventNotFoundError('missing-event')
      );

      const response = await app.inject({ method: 'GET', url: '/events/missing-event/performances' });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'Event not found: missing-event' });
    });

    it('returns 400 for a whitespace-only eventId, without calling the catalog', async () => {
      const response = await app.inject({ method: 'GET', url: '/events/%20/performances' });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'Invalid eventId' });
      expect(eventCatalog.listPerformancesByEvent).not.toHaveBeenCalled();
    });
  });
});
