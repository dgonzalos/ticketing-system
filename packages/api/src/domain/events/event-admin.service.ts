import { randomUUID } from 'node:crypto';
import {
  EventNotFoundError,
  PerformanceAlreadyScheduledError,
  PerformanceHasSalesError,
  PerformanceNotFoundError,
} from '../common/errors/domain-errors.js';
import { generateSeatMap } from '../seats/seat-map.js';
import type {
  CancelPerformanceCommand,
  CreateEventCommand,
  CreatePerformancesCommand,
  UpdateEventCommand,
} from './catalog-commands.js';
import type { Event, IEventRepository, NewPerformanceInput, Performance } from './event.repository.js';

/**
 * Write side of the events/performances catalog. Each public method takes
 * exactly one parsed command object (never loose positional arguments) —
 * this is what lets a future AI Admin Assistant call these same methods
 * with the same commands it parses from natural language, via the same
 * schemas in `catalog-commands.ts` that the HTTP routes already parse with.
 */
export class EventAdminService {
  constructor(private readonly eventRepository: IEventRepository) {}

  async createEvent(command: CreateEventCommand): Promise<Event> {
    return this.eventRepository.createEvent({
      eventId: randomUUID(),
      title: command.title,
      description: command.description ?? null,
      imageUrl: command.imageUrl ?? null,
    });
  }

  /**
   * @throws {EventNotFoundError} if `command.eventId` does not exist.
   */
  async updateEvent(command: UpdateEventCommand): Promise<Event> {
    const { eventId, ...changes } = command;
    const updated = await this.eventRepository.updateEvent(eventId, changes);
    if (!updated) {
      throw new EventNotFoundError(eventId);
    }
    return updated;
  }

  /**
   * Schedules a batch of performances for an event, generating each one's
   * seat map in the same all-or-nothing transaction as the performance rows
   * themselves — a performance with no seats is unsellable.
   *
   * @throws {EventNotFoundError} if `command.eventId` does not exist.
   * @throws {PerformanceAlreadyScheduledError} if a submitted performance
   * duplicates an existing `scheduled` performance for the same
   * event/date/time/venue, or duplicates another performance within the
   * same submitted batch.
   */
  async createPerformances(command: CreatePerformancesCommand): Promise<Performance[]> {
    const event = await this.eventRepository.findEventById(command.eventId);
    if (!event) {
      throw new EventNotFoundError(command.eventId);
    }

    // Within-batch duplicates first, synchronously, before any DB call —
    // pure in-memory, so a within-batch duplicate is rejected without ever
    // touching the repository.
    const seenInBatch = new Set<string>();
    for (const performance of command.performances) {
      const batchKey = `${performance.date}|${performance.time}|${performance.venue}`;
      if (seenInBatch.has(batchKey)) {
        throw new PerformanceAlreadyScheduledError(command.eventId, performance.date, performance.time, performance.venue);
      }
      seenInBatch.add(batchKey);
    }

    // Duplicate-vs-existing-data checks run in parallel, not one at a time
    // — this is purely a fast-path UX nicety that produces a precise error
    // before ever hitting the write path; it's not what prevents a
    // duplicate under concurrency (the database's own
    // performances_scheduled_slot_unique constraint is — see
    // DrizzleEventRepository.createPerformances), so there's no ordering
    // requirement across these reads that would force them to be sequential.
    const existingMatches = await Promise.all(
      command.performances.map((performance) =>
        this.eventRepository.findScheduledPerformance(command.eventId, performance.date, performance.time, performance.venue)
      )
    );
    const duplicateIndex = existingMatches.findIndex((existing) => existing !== null);
    if (duplicateIndex !== -1) {
      const duplicate = command.performances[duplicateIndex];
      throw new PerformanceAlreadyScheduledError(command.eventId, duplicate.date, duplicate.time, duplicate.venue);
    }

    const rows: NewPerformanceInput[] = command.performances.map((performance) => {
      const performanceId = randomUUID();
      return {
        performanceId,
        eventId: command.eventId,
        date: performance.date,
        time: performance.time,
        venue: performance.venue,
        city: performance.city,
        capacity: performance.capacity ?? generateSeatMap(performanceId).length,
      };
    });

    return this.eventRepository.createPerformances(rows, generateSeatMap);
  }

  /**
   * @throws {PerformanceNotFoundError} if `command.performanceId` does not exist.
   * @throws {PerformanceHasSalesError} if the performance has any sold
   * seats — refusing is correct here: cancelling would mean refunding real
   * Stripe payments, and no refund path exists yet. Cancelling an
   * already-`cancelled` performance is a no-op that returns normally.
   *
   * The existence check, sold-seats check, and the actual cancellation all
   * happen atomically inside `eventRepository.cancelPerformance` itself
   * (locked in one transaction) — deliberately not as separate calls here,
   * since a separate "check, then act" would leave a window for a
   * concurrent checkout to sell a seat in between.
   */
  async cancelPerformance(command: CancelPerformanceCommand): Promise<void> {
    const outcome = await this.eventRepository.cancelPerformance(command.performanceId);
    if (outcome === 'not_found') {
      throw new PerformanceNotFoundError(command.performanceId);
    }
    if (outcome === 'has_sales') {
      throw new PerformanceHasSalesError(command.performanceId);
    }
  }
}
