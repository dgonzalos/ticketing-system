import type { FastifyPluginAsync } from 'fastify';
import type { EventSummaryDto, PerformanceSummaryDto } from '@ticketing-system/shared';
import { EventNotFoundError } from '../../domain/common/errors/domain-errors.js';
import type { EventCatalog, EventSummary, PerformanceSummary } from '../../domain/events/event-catalog.js';

export interface EventsRoutesOptions {
  eventCatalog: EventCatalog;
}

interface EventIdParams {
  eventId: string;
}

interface ErrorResponse {
  error: string;
}

/**
 * Explicit field-by-field mapping, for the same reason as
 * `toPerformanceResponse` below: the wire shape is decided here, never by
 * whatever the domain object happens to carry.
 */
function toEventResponse(event: EventSummary): EventSummaryDto {
  return {
    eventId: event.eventId,
    title: event.title,
    description: event.description,
    imageUrl: event.imageUrl,
    nextPerformance: event.nextPerformance,
    upcomingPerformanceCount: event.upcomingPerformanceCount,
    fromPriceCents: event.fromPriceCents,
    heldSeats: event.heldSeats,
  };
}

/**
 * Explicit field-by-field mapping, not an identity return — `Performance`
 * now carries a `status` field (see `event.repository.ts`) that
 * `PerformanceSummaryDto` deliberately does not: this route only ever
 * returns `scheduled` performances (the repository already filters that),
 * but the mapping strips `status` defensively so a cancelled performance's
 * shape can never reach this public route even if that filtering logic
 * changes.
 */
function toPerformanceResponse(performance: PerformanceSummary): PerformanceSummaryDto {
  return {
    performanceId: performance.performanceId,
    eventId: performance.eventId,
    date: performance.date,
    time: performance.time,
    venue: performance.venue,
    city: performance.city,
    capacity: performance.capacity,
    availableSeats: performance.availableSeats,
    fromPriceCents: performance.fromPriceCents,
    heldSeats: performance.heldSeats,
  };
}

/**
 * Whether `eventId` is well-formed enough to look up. Event ids in this
 * system are free-form text primary keys (e.g. "event-1"), not UUIDs, so
 * validation is deliberately loose: non-empty after trimming.
 */
function isValidEventId(eventId: string): boolean {
  return eventId.trim().length > 0;
}

/**
 * Events/performances catalog routes: public, read-only browsing of what's
 * on sale. All business logic is delegated to the injected
 * {@link EventCatalog} — this plugin only maps domain results/errors to HTTP
 * responses. Both routes serve the public read models (`EventSummary`,
 * `PerformanceSummary`), not the plain `listEvents`/`listPerformancesByEvent`
 * the admin assistant's read tools use.
 */
export const eventsRoutes: FastifyPluginAsync<EventsRoutesOptions> = async (app, { eventCatalog }) => {
  /**
   * GET /events
   *
   * Public. Lists every event with its next upcoming performance, upcoming
   * performance count, and cheapest available seat — ordered by next
   * performance, events with nothing upcoming last.
   *
   * Responses: 200 with the event array.
   */
  app.get<{ Reply: EventSummaryDto[] }>('/events', async (_request, reply) => {
    const events = await eventCatalog.listEventSummaries();
    return reply.code(200).send(events.map(toEventResponse));
  });

  /**
   * GET /events/:eventId/performances
   *
   * Public. Lists an event's upcoming performances (past ones are never
   * offered) with live availability, sorted by date/time.
   *
   * Responses: 200 with the performance array, 400 for an invalid eventId,
   * 404 if the event does not exist.
   */
  app.get<{ Params: EventIdParams; Reply: PerformanceSummaryDto[] | ErrorResponse }>(
    '/events/:eventId/performances',
    async (request, reply) => {
      const { eventId } = request.params;
      if (!isValidEventId(eventId)) {
        return reply.code(400).send({ error: 'Invalid eventId' });
      }

      try {
        const performances = await eventCatalog.listPerformanceSummariesByEvent(eventId);
        return reply.code(200).send(performances.map(toPerformanceResponse));
      } catch (err) {
        if (err instanceof EventNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    }
  );
};
