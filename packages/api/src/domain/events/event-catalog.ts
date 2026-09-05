import { EventNotFoundError } from '../common/errors/domain-errors.js';
import type { Event, IEventRepository, Performance } from './event.repository.js';

export type { Event, Performance } from './event.repository.js';

/**
 * Read-only catalog of events and their scheduled performances. Unlike
 * {@link SeatLockManager}, this has no concurrency/ownership rules to
 * enforce — it delegates all persistence to the injected
 * {@link IEventRepository} and this class has no knowledge of the database,
 * ORM, or web framework in use.
 */
export class EventCatalog {
  constructor(private readonly repository: IEventRepository) {}

  /** Lists every event, for rendering the top-level events list. */
  async listEvents(): Promise<Event[]> {
    return this.repository.listEvents();
  }

  /**
   * Lists every performance belonging to `eventId`, sorted by date/time,
   * for rendering the event's schedule.
   *
   * @throws {EventNotFoundError} if the event does not exist.
   */
  async listPerformancesByEvent(eventId: string): Promise<Performance[]> {
    // Run both queries concurrently rather than gating the second on the
    // first: the existence check and the listing are independent reads, so
    // there's no reason to pay two sequential round trips for the common
    // (event exists) case.
    const [event, performances] = await Promise.all([
      this.repository.findEventById(eventId),
      this.repository.listPerformancesByEvent(eventId),
    ]);

    if (!event) {
      throw new EventNotFoundError(eventId);
    }

    return [...performances].sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
  }
}
