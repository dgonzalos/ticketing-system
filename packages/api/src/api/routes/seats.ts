import type { FastifyPluginAsync } from 'fastify';
import { z, ZodError } from 'zod';
import type { SeatDetailsDto } from '@ticketing-system/shared';
import { SeatLockOwnershipError, SeatNotFoundError } from '../../domain/common/errors/domain-errors.js';
import type { SeatDetails, SeatLockManager } from '../../domain/seats/seat-lock.js';

export interface SeatsRoutesOptions {
  seatLockManager: SeatLockManager;
}

interface SeatIdParams {
  seatId: string;
}

interface ListSeatsQuery {
  performanceId?: string;
}

interface SelectSeatResponse {
  success: boolean;
  expiresAt: string;
  seatId: string;
}

interface UnlockSeatResponse {
  success: boolean;
}

interface ConfirmSeatResponse {
  success: boolean;
}

interface ErrorResponse {
  error: string;
}

/**
 * Maps the domain's `SeatDetails` to the shared `SeatDetailsDto` wire shape
 * (dates as ISO strings). `reservedBy` is deliberately dropped: this route
 * is public (no auth), and who holds a reservation is not information an
 * anonymous caller should be able to enumerate.
 */
function toSeatDetailsResponse(seat: SeatDetails): SeatDetailsDto {
  const { reservedBy: _reservedBy, ...rest } = seat;
  return { ...rest, reservedUntil: seat.reservedUntil?.toISOString() ?? null };
}

const checkAvailabilityBodySchema = z.object({
  seatIds: z.array(z.string().min(1)).min(1),
});
type CheckAvailabilityBody = z.infer<typeof checkAvailabilityBodySchema>;
type CheckAvailabilityResponse = Record<string, boolean>;

/**
 * Whether `seatId` is well-formed enough to look up. Seat ids in this
 * system are free-form text primary keys (e.g. "seat-A12"), not UUIDs, so
 * validation is deliberately loose: non-empty after trimming.
 */
function isValidSeatId(seatId: string): boolean {
  return seatId.trim().length > 0;
}

/**
 * Seat-selection routes: temporary locking/unlocking of seats ahead of
 * checkout, and a public availability check. All business logic is
 * delegated to the injected {@link SeatLockManager} — this plugin only
 * validates input and maps domain results/errors to HTTP responses.
 */
export const seatsRoutes: FastifyPluginAsync<SeatsRoutesOptions> = async (app, { seatLockManager }) => {
  /**
   * GET /seats?performanceId=:id
   *
   * Public. Lists every seat belonging to a performance, for rendering a
   * seat map.
   *
   * Responses: 200 with the seat array, 400 if `performanceId` is missing.
   */
  app.get<{ Querystring: ListSeatsQuery; Reply: SeatDetailsDto[] | ErrorResponse }>(
    '/seats',
    async (request, reply) => {
      const { performanceId } = request.query;
      if (!performanceId || performanceId.trim().length === 0) {
        return reply.code(400).send({ error: 'performanceId query parameter is required' });
      }

      const seats = await seatLockManager.listSeats(performanceId);
      return reply.code(200).send(seats.map(toSeatDetailsResponse));
    }
  );

  /**
   * POST /seats/:seatId/select
   *
   * Reserves a seat for the authenticated user for 5 minutes.
   *
   * Auth: required (Bearer JWT, verified by `app.authenticate`).
   * Responses: 200 on success, 409 if already reserved by someone else,
   * 400 for an invalid seatId, 401 if unauthenticated, 404 if the seat
   * does not exist.
   */
  app.post<{ Params: SeatIdParams; Reply: SelectSeatResponse | ErrorResponse }>(
    '/seats/:seatId/select',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { seatId } = request.params;
      if (!isValidSeatId(seatId)) {
        return reply.code(400).send({ error: 'Invalid seatId' });
      }

      const userId = request.user.userId;

      try {
        const result = await seatLockManager.lockSeat(seatId, userId);
        return reply
          .code(result.success ? 200 : 409)
          .send({ success: result.success, expiresAt: result.expiresAt.toISOString(), seatId });
      } catch (err) {
        if (err instanceof SeatNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  /**
   * DELETE /seats/:seatId/select
   *
   * Releases the authenticated user's reservation on a seat.
   *
   * Auth: required (Bearer JWT, verified by `app.authenticate`).
   * Responses: 200 on success, 404 if the seat does not exist, 403 if the
   * seat is not currently held by the caller, 401 if unauthenticated.
   */
  app.delete<{ Params: SeatIdParams; Reply: UnlockSeatResponse | ErrorResponse }>(
    '/seats/:seatId/select',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { seatId } = request.params;
      if (!isValidSeatId(seatId)) {
        return reply.code(400).send({ error: 'Invalid seatId' });
      }

      const userId = request.user.userId;

      try {
        await seatLockManager.unlockSeat(seatId, userId);
        return reply.code(200).send({ success: true });
      } catch (err) {
        if (err instanceof SeatNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        if (err instanceof SeatLockOwnershipError) {
          return reply.code(403).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  /**
   * POST /seats/:seatId/confirm
   *
   * Converts the authenticated user's active reservation into a sale.
   *
   * Auth: required (Bearer JWT, verified by `app.authenticate`).
   * Responses: 200 on success, 404 if the seat does not exist, 403 if the
   * seat is not currently (validly) held by the caller, 401 if
   * unauthenticated.
   */
  app.post<{ Params: SeatIdParams; Reply: ConfirmSeatResponse | ErrorResponse }>(
    '/seats/:seatId/confirm',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { seatId } = request.params;
      if (!isValidSeatId(seatId)) {
        return reply.code(400).send({ error: 'Invalid seatId' });
      }

      const userId = request.user.userId;

      try {
        await seatLockManager.confirmSeat(seatId, userId);
        return reply.code(200).send({ success: true });
      } catch (err) {
        if (err instanceof SeatNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        if (err instanceof SeatLockOwnershipError) {
          return reply.code(403).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  /**
   * POST /seats/check-availability
   *
   * Public (no auth). Reports whether each requested seat is currently
   * available to lock.
   *
   * Body: `{ seatIds: string[] }`.
   * Responses: 200 with a `{ [seatId]: boolean }` map, 400 if the body is
   * malformed.
   */
  app.post<{ Reply: CheckAvailabilityResponse | ErrorResponse }>('/seats/check-availability', async (request, reply) => {
    let body: CheckAvailabilityBody;
    try {
      body = checkAvailabilityBodySchema.parse(request.body);
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({ error: 'Invalid request body' });
      }
      throw err;
    }

    const availability = await seatLockManager.checkAvailability(body.seatIds);
    return reply.code(200).send(availability);
  });
};
