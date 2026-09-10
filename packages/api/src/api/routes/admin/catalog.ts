import type { FastifyPluginAsync } from 'fastify';
import { ZodError } from 'zod';
import type {
  CancelPerformanceResponseDto,
  CreateEventRequestDto,
  CreatePerformancesRequestDto,
  EventDto,
  UpdateEventRequestDto,
} from '@ticketing-system/shared';
import {
  EventNotFoundError,
  PerformanceAlreadyScheduledError,
  PerformanceHasSalesError,
  PerformanceNotFoundError,
} from '../../../domain/common/errors/domain-errors.js';
import {
  CancelPerformanceCommandSchema,
  CreateEventCommandSchema,
  CreatePerformancesCommandSchema,
  UpdateEventCommandSchema,
} from '../../../domain/events/catalog-commands.js';
import type { EventAdminService } from '../../../domain/events/event-admin.service.js';
import type { Event, Performance } from '../../../domain/events/event.repository.js';

export interface AdminCatalogRoutesOptions {
  eventAdminService: EventAdminService;
}

interface EventIdParams {
  eventId: string;
}

interface PerformanceIdParams {
  performanceId: string;
}

interface ErrorResponse {
  error: string;
}

function toEventResponse(event: Event): EventDto {
  return event;
}

/**
 * Admin catalog write routes: create/update events, schedule performances
 * in bulk, cancel a performance. All business logic is delegated to the
 * injected {@link EventAdminService}; this plugin only parses commands with
 * the shared schemas from `catalog-commands.ts` and maps domain
 * results/errors to HTTP responses. Every route requires an authenticated
 * admin.
 */
export const adminCatalogRoutes: FastifyPluginAsync<AdminCatalogRoutesOptions> = async (app, { eventAdminService }) => {
  /**
   * POST /admin/events
   *
   * Auth: required, admin only (`app.authenticate`, `app.requireAdmin`).
   * Body: `{ title, description?, imageUrl? }` (see `CreateEventRequestDto`).
   * Responses: 201 with the created event, 400 for a malformed body.
   */
  app.post<{ Body: CreateEventRequestDto; Reply: EventDto | ErrorResponse }>(
    '/admin/events',
    { onRequest: [app.authenticate, app.requireAdmin] },
    async (request, reply) => {
      let command;
      try {
        command = CreateEventCommandSchema.parse(request.body);
      } catch (err) {
        if (err instanceof ZodError) {
          return reply.code(400).send({ error: 'Invalid request body' });
        }
        throw err;
      }

      const event = await eventAdminService.createEvent(command);
      return reply.code(201).send(toEventResponse(event));
    }
  );

  /**
   * PATCH /admin/events/:eventId
   *
   * Auth: required, admin only.
   * Body: `{ title?, description?, imageUrl? }`, at least one field (see
   * `UpdateEventRequestDto`).
   * Responses: 200 with the updated event, 400 for a malformed body (or a
   * body with no fields to change), 404 if the event does not exist.
   */
  app.patch<{ Params: EventIdParams; Body: UpdateEventRequestDto; Reply: EventDto | ErrorResponse }>(
    '/admin/events/:eventId',
    { onRequest: [app.authenticate, app.requireAdmin] },
    async (request, reply) => {
      let command;
      try {
        command = UpdateEventCommandSchema.parse({ eventId: request.params.eventId, ...request.body });
      } catch (err) {
        if (err instanceof ZodError) {
          return reply.code(400).send({ error: 'Invalid request body' });
        }
        throw err;
      }

      try {
        const event = await eventAdminService.updateEvent(command);
        return reply.code(200).send(toEventResponse(event));
      } catch (err) {
        if (err instanceof EventNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  /**
   * POST /admin/events/:eventId/performances
   *
   * Schedules one or more performances for an event, generating each one's
   * seat map in the same transaction as the performance rows.
   *
   * Auth: required, admin only.
   * Body: `{ performances: [{ date, time, venue, city, capacity? }] }` (see
   * `CreatePerformancesRequestDto`). If the body also carries an `eventId`
   * that disagrees with the path, responds 400 rather than silently
   * preferring either value.
   * Responses: 201 with the created performances, 400 for a malformed body
   * or a path/body eventId mismatch, 404 if the event does not exist, 409
   * if a submitted performance duplicates an existing scheduled one (or
   * another performance in the same batch).
   */
  app.post<{
    Params: EventIdParams;
    Body: CreatePerformancesRequestDto & { eventId?: string };
    Reply: { performances: Performance[] } | ErrorResponse;
  }>('/admin/events/:eventId/performances', { onRequest: [app.authenticate, app.requireAdmin] }, async (request, reply) => {
    const { eventId } = request.params;
    if (request.body?.eventId !== undefined && request.body.eventId !== eventId) {
      return reply.code(400).send({ error: 'Path eventId and body eventId must match' });
    }

    let command;
    try {
      command = CreatePerformancesCommandSchema.parse({ eventId, performances: request.body?.performances });
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({ error: 'Invalid request body' });
      }
      throw err;
    }

    try {
      const performances = await eventAdminService.createPerformances(command);
      return reply.code(201).send({ performances });
    } catch (err) {
      if (err instanceof EventNotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      if (err instanceof PerformanceAlreadyScheduledError) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });

  /**
   * POST /admin/performances/:performanceId/cancel
   *
   * Cancels a performance: flips its status and blocks its remaining
   * available seats. Refuses if any seats have already sold.
   *
   * Auth: required, admin only.
   * Responses: 200 with `{ performanceId, status: 'cancelled' }`, 404 if
   * the performance does not exist, 409 if it has sold seats.
   */
  app.post<{ Params: PerformanceIdParams; Reply: CancelPerformanceResponseDto | ErrorResponse }>(
    '/admin/performances/:performanceId/cancel',
    { onRequest: [app.authenticate, app.requireAdmin] },
    async (request, reply) => {
      let command;
      try {
        command = CancelPerformanceCommandSchema.parse({ performanceId: request.params.performanceId });
      } catch (err) {
        if (err instanceof ZodError) {
          return reply.code(400).send({ error: 'Invalid request' });
        }
        throw err;
      }

      try {
        await eventAdminService.cancelPerformance(command);
        return reply.code(200).send({ performanceId: command.performanceId, status: 'cancelled' });
      } catch (err) {
        if (err instanceof PerformanceNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        if (err instanceof PerformanceHasSalesError) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    }
  );
};
