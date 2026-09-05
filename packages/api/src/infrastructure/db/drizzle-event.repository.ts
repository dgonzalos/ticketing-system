import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Event, IEventRepository, Performance } from '../../domain/events/event.repository.js';
import * as schema from './schema/index.js';

type EventRow = typeof schema.eventsTable.$inferSelect;
type PerformanceRow = typeof schema.performancesTable.$inferSelect;

function toEvent(row: EventRow): Event {
  return {
    eventId: row.id,
    title: row.title,
    description: row.description,
    imageUrl: row.imageUrl,
  };
}

function toPerformance(row: PerformanceRow): Performance {
  return {
    performanceId: row.id,
    eventId: row.eventId,
    date: row.date,
    time: row.time,
    venue: row.venue,
    city: row.city,
    capacity: row.capacity,
  };
}

/** Drizzle/PostgreSQL implementation of {@link IEventRepository}. Read-only listing — no locking needed. */
export class DrizzleEventRepository implements IEventRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async listEvents(): Promise<Event[]> {
    const rows = await this.db.select().from(schema.eventsTable);
    return rows.map(toEvent);
  }

  async findEventById(eventId: string): Promise<Event | null> {
    const rows = await this.db.select().from(schema.eventsTable).where(eq(schema.eventsTable.id, eventId));
    return rows[0] ? toEvent(rows[0]) : null;
  }

  async listPerformancesByEvent(eventId: string): Promise<Performance[]> {
    const rows = await this.db
      .select()
      .from(schema.performancesTable)
      .where(eq(schema.performancesTable.eventId, eventId));
    return rows.map(toPerformance);
  }
}
