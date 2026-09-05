/** A show/production, listable independently of any specific scheduled date. */
export interface Event {
  eventId: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
}

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
   * Lists every performance belonging to `eventId`, for rendering the
   * event's schedule. Does not itself verify that the event exists — callers
   * needing that check should call {@link findEventById} first.
   */
  listPerformancesByEvent(eventId: string): Promise<Performance[]>;
}
