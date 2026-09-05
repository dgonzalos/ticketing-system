import type { FastifyPluginAsync } from 'fastify';
import type { EventDto, PerformanceDto } from '@ticketing-system/shared';
import { EventNotFoundError } from '../../domain/common/errors/domain-errors.js';
import type { Event, EventCatalog, Performance } from '../../domain/events/event-catalog.js';

export interface EventsRoutesOptions {
  eventCatalog: EventCatalog;
}

interface EventIdParams {
  eventId: string;
}

interface ErrorResponse {
  error: string;
}

function toEventResponse(event: Event): EventDto {
  return event;
}

function toPerformanceResponse(performance: Performance): PerformanceDto {
  return performance;
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
 * responses.
 */
export const eventsRoutes: FastifyPluginAsync<EventsRoutesOptions> = async (app, { eventCatalog }) => {
  /**
   * GET /events
   *
   * Public. Lists every event.
   *
   * Responses: 200 with the event array.
   */
  app.get<{ Reply: EventDto[] }>('/events', async (_request, reply) => {
    const events = await eventCatalog.listEvents();
    return reply.code(200).send(events.map(toEventResponse));
  });

  /**
   * GET /events/:eventId/performances
   *
   * Public. Lists every performance scheduled for an event, sorted by
   * date/time.
   *
   * Responses: 200 with the performance array, 400 for an invalid eventId,
   * 404 if the event does not exist.
   */
  app.get<{ Params: EventIdParams; Reply: PerformanceDto[] | ErrorResponse }>(
    '/events/:eventId/performances',
    async (request, reply) => {
      const { eventId } = request.params;
      if (!isValidEventId(eventId)) {
        return reply.code(400).send({ error: 'Invalid eventId' });
      }

      try {
        const performances = await eventCatalog.listPerformancesByEvent(eventId);
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
