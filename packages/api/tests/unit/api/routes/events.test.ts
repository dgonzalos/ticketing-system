import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventsRoutes } from '../../../../src/api/routes/events.js';
import { EventNotFoundError } from '../../../../src/domain/common/errors/domain-errors.js';
import type { EventCatalog, EventSummary, PerformanceSummary } from '../../../../src/domain/events/event-catalog.js';

function createMockEventCatalog(): EventCatalog {
  return {
    listEvents: vi.fn(),
    listPerformancesByEvent: vi.fn(),
    listEventSummaries: vi.fn(),
    listPerformanceSummariesByEvent: vi.fn(),
  } as unknown as EventCatalog;
}

async function buildApp(eventCatalog: EventCatalog): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(eventsRoutes, { eventCatalog });
  return app;
}

const eventSummary: EventSummary = {
  eventId: 'event-1',
  title: 'The Lighthouse Keeper',
  description: null,
  imageUrl: null,
  nextPerformance: { date: '2026-10-16', time: '19:30:00', venue: 'Teatro Alameda', city: 'Madrid' },
  upcomingPerformanceCount: 3,
  fromPriceCents: 5000,
  heldSeats: 2,
};

const performanceSummary: PerformanceSummary = {
  performanceId: 'perf-1',
  eventId: 'event-1',
  date: '2026-10-16',
  time: '19:30:00',
  venue: 'Teatro Alameda',
  city: 'Madrid',
  capacity: 100,
  status: 'scheduled',
  availableSeats: 4,
  fromPriceCents: 9000,
  heldSeats: 1,
};

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
    it('returns 200 with each event and its schedule summary, no auth required', async () => {
      (eventCatalog.listEventSummaries as ReturnType<typeof vi.fn>).mockResolvedValueOnce([eventSummary]);

      const response = await app.inject({ method: 'GET', url: '/events' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([eventSummary]);
    });

    it('passes through an event with nothing upcoming as null/0/null', async () => {
      const noDates: EventSummary = { ...eventSummary, nextPerformance: null, upcomingPerformanceCount: 0, fromPriceCents: null, heldSeats: 0 };
      (eventCatalog.listEventSummaries as ReturnType<typeof vi.fn>).mockResolvedValueOnce([noDates]);

      const response = await app.inject({ method: 'GET', url: '/events' });

      expect(response.json()).toEqual([noDates]);
    });

    it('serves the public summaries, never the plain list the admin assistant reads', async () => {
      (eventCatalog.listEventSummaries as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await app.inject({ method: 'GET', url: '/events' });

      expect(eventCatalog.listEvents).not.toHaveBeenCalled();
    });
  });

  describe('GET /events/:eventId/performances', () => {
    it('returns 200 with each performance and its availability, without status', async () => {
      (eventCatalog.listPerformanceSummariesByEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce([performanceSummary]);

      const response = await app.inject({ method: 'GET', url: '/events/event-1/performances' });

      expect(response.statusCode).toBe(200);
      const { status: _status, ...withoutStatus } = performanceSummary;
      expect(response.json()).toEqual([withoutStatus]);
      expect(response.json()[0]).not.toHaveProperty('status');
      expect(eventCatalog.listPerformanceSummariesByEvent).toHaveBeenCalledWith('event-1');
      expect(eventCatalog.listPerformancesByEvent).not.toHaveBeenCalled();
    });

    it('returns a sold-out performance as availableSeats 0 and fromPriceCents null', async () => {
      const soldOut = { ...performanceSummary, availableSeats: 0, fromPriceCents: null };
      (eventCatalog.listPerformanceSummariesByEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce([soldOut]);

      const response = await app.inject({ method: 'GET', url: '/events/event-1/performances' });

      expect(response.json()[0]).toMatchObject({ availableSeats: 0, fromPriceCents: null });
    });

    it('returns 404 when the event does not exist', async () => {
      (eventCatalog.listPerformanceSummariesByEvent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
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
      expect(eventCatalog.listPerformanceSummariesByEvent).not.toHaveBeenCalled();
    });
  });
});
