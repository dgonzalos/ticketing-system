import type { NewSeatInput } from '../seats/seat-map.js';

/** A show/production, listable independently of any specific scheduled date. */
export interface Event {
  eventId: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
}

/**
 * Lifecycle state of a performance. `cancelled` is a status flip, never a
 * delete — see `performanceStatusEnum`'s doc comment in
 * `infrastructure/db/schema/performances.ts`. Declared here (not imported
 * from that schema file) because the domain layer must not import a
 * specific database driver or ORM.
 */
export type PerformanceStatus = 'scheduled' | 'cancelled';

/** A single scheduled instance of an event: a specific date/time/venue. */
export interface Performance {
  performanceId: string;
  eventId: string;
  /** Calendar date, e.g. `'2026-03-14'`. */
  date: string;
  /** Start time of day, e.g. `'19:30:00'`. */
  time: string;
  venue: string;
  city: string;
  capacity: number;
  status: PerformanceStatus;
}

/** Fields required to create a new event. */
export interface NewEventInput {
  eventId: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
}

/** Fields an admin may change on an existing event — all optional, at least one must be present. */
export interface EventChanges {
  title?: string;
  description?: string | null;
  imageUrl?: string | null;
}

/** Fields required to create a new performance (before its seats are generated). */
export interface NewPerformanceInput {
  performanceId: string;
  eventId: string;
  date: string;
  time: string;
  venue: string;
  city: string;
  capacity: number;
}

/**
 * Framework-agnostic persistence contract for the events/performances
 * catalog. The domain layer depends on this interface only — it must not
 * import a specific database driver or ORM.
 */
export interface IEventRepository {
  /** Lists every event, for rendering the top-level events list. */
  listEvents(): Promise<Event[]>;

  /** Reads a single event, or null if it does not exist. */
  findEventById(eventId: string): Promise<Event | null>;

  /**
   * Lists every `scheduled` performance belonging to `eventId`, for
   * rendering the event's public schedule — a cancelled performance is
   * never returned here. Does not itself verify that the event exists —
   * callers needing that check should call {@link findEventById} first.
   */
  listPerformancesByEvent(eventId: string): Promise<Performance[]>;

  /**
   * Lists every performance belonging to `eventId` regardless of status
   * (`scheduled` and `cancelled` both), for admin use. Not yet consumed by
   * any route — laid down now as cheap forward-infrastructure for a future
   * admin UI/reporting phase.
   */
  listAllPerformancesByEvent(eventId: string): Promise<Performance[]>;

  /** Reads a single performance, or null if it does not exist. */
  findPerformanceById(performanceId: string): Promise<Performance | null>;

  /** Creates a new event. */
  createEvent(event: NewEventInput): Promise<Event>;

  /**
   * Applies `changes` to an existing event.
   *
   * @returns The updated event, or null if `eventId` does not exist — this
   * repository never throws domain errors; the caller (see
   * `EventAdminService`) turns a null result into {@link EventNotFoundError}.
   */
  updateEvent(eventId: string, changes: EventChanges): Promise<Event | null>;

  /**
   * Inserts every performance in `rows` and, for each one, the seats
   * `seatsFor` generates for it — all in one transaction, so it either
   * fully commits or fully rolls back. A performance created with no seats
   * is unsellable, which is why seat generation is mandatory here rather
   * than a separate step.
   *
   * @throws {PerformanceAlreadyScheduledError} if any row collides with an
   * existing `scheduled` performance (same event/date/time/venue) or with
   * another row in the same batch — enforced by a database-level unique
   * index, not just application logic, since that's the only thing that
   * can actually close the race between two concurrent identical requests.
   * This is the one exception to "the repository never throws domain
   * errors" elsewhere on this interface: the violation is inherently a
   * repository-level concern (it's the database constraint that decided
   * it), not something the caller could validate any other way.
   */
  createPerformances(
    rows: NewPerformanceInput[],
    seatsFor: (performanceId: string) => NewSeatInput[]
  ): Promise<Performance[]>;

  /**
   * Finds an existing `scheduled` performance matching this exact
   * event/date/time/venue combination, or null if none exists — used for
   * duplicate-slot detection when scheduling new performances.
   */
  findScheduledPerformance(eventId: string, date: string, time: string, venue: string): Promise<Performance | null>;

  /**
   * Atomically cancels a performance: if it exists, is not already
   * `cancelled`, and has no `sold` seats, flips its status to `cancelled`
   * and flips every currently-`available` or `reserved` seat to `blocked`
   * (releasing any active reservation) — all inside one transaction that
   * locks the performance row and every one of its seats (`SELECT ... FOR
   * UPDATE`) before deciding. This is deliberately *not* a separate
   * "check if it has sales" read followed by a separate write: a plain
   * check-then-act would leave a window where a concurrent checkout could
   * sell a seat between the check and the write, leaving a `cancelled`
   * performance with an undetected paid sale on it (see
   * `DrizzleOrderRepository.createOrder`'s `lockSeatsForUpdate` for the
   * same locking pattern applied to purchase concurrency). `reserved`
   * seats are released deliberately, not just `available` ones — a
   * `reserved` seat is an active, unpaid checkout hold, and leaving it
   * alone would let that checkout still complete and pay for a
   * now-cancelled performance. Seats already `sold` are always left
   * untouched.
   *
   * @returns `'not_found'` if `performanceId` does not exist; `'has_sales'`
   * if it has any `sold` seats (nothing is changed); `'cancelled'`
   * otherwise — whether it was just cancelled or already was (idempotent).
   * The repository never throws a domain error for these outcomes — the
   * caller (see `EventAdminService.cancelPerformance`) maps them.
   */
  cancelPerformance(performanceId: string): Promise<'cancelled' | 'not_found' | 'has_sales'>;
}
