import { and, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PerformanceAlreadyScheduledError } from '../../domain/common/errors/domain-errors.js';
import type {
  Event,
  EventChanges,
  IEventRepository,
  NewEventInput,
  NewPerformanceInput,
  Performance,
} from '../../domain/events/event.repository.js';
import type { NewSeatInput } from '../../domain/seats/seat-map.js';
import type { DbTransaction } from './seat-queries.js';
import * as schema from './schema/index.js';

type EventRow = typeof schema.eventsTable.$inferSelect;
type PerformanceRow = typeof schema.performancesTable.$inferSelect;

/** Postgres error code for a unique-constraint violation. */
const UNIQUE_VIOLATION = '23505';

/** Name of the partial unique index, matching `schema/performances.ts` and its migration. */
const SCHEDULED_SLOT_UNIQUE_CONSTRAINT = 'performances_scheduled_slot_unique';

/**
 * Whether `err` is (or wraps) a violation of the scheduled-slot unique
 * index specifically — see `DrizzleUserRepository`'s identically-shaped
 * `isEmailUniqueViolation` for why both `err` and `err.cause` need
 * checking (Drizzle's node-postgres driver wraps the real `pg` error,
 * which carries `.code`/`.constraint`, in its own `DrizzleQueryError`).
 */
function isScheduledSlotUniqueViolation(err: unknown): boolean {
  const pgErr = err as { code?: unknown; constraint?: unknown; cause?: { code?: unknown; constraint?: unknown } };
  const code = pgErr?.code ?? pgErr?.cause?.code;
  const constraint = pgErr?.constraint ?? pgErr?.cause?.constraint;
  return code === UNIQUE_VIOLATION && constraint === SCHEDULED_SLOT_UNIQUE_CONSTRAINT;
}

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
    status: row.status,
  };
}

/**
 * Drizzle/PostgreSQL implementation of {@link IEventRepository}. Started as
 * read-only listing (no locking needed); `createPerformances` and
 * `cancelPerformance` are this file's first use of a transaction, mirroring
 * the template in `DrizzleOrderRepository.createOrder`.
 */
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
      .where(and(eq(schema.performancesTable.eventId, eventId), eq(schema.performancesTable.status, 'scheduled')));
    return rows.map(toPerformance);
  }

  async listAllPerformancesByEvent(eventId: string): Promise<Performance[]> {
    const rows = await this.db
      .select()
      .from(schema.performancesTable)
      .where(eq(schema.performancesTable.eventId, eventId));
    return rows.map(toPerformance);
  }

  async findPerformanceById(performanceId: string): Promise<Performance | null> {
    const rows = await this.db
      .select()
      .from(schema.performancesTable)
      .where(eq(schema.performancesTable.id, performanceId));
    return rows[0] ? toPerformance(rows[0]) : null;
  }

  async createEvent(event: NewEventInput): Promise<Event> {
    const [row] = await this.db
      .insert(schema.eventsTable)
      .values({ id: event.eventId, title: event.title, description: event.description, imageUrl: event.imageUrl })
      .returning();
    return toEvent(row);
  }

  async updateEvent(eventId: string, changes: EventChanges): Promise<Event | null> {
    const [row] = await this.db
      .update(schema.eventsTable)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(schema.eventsTable.id, eventId))
      .returning();
    return row ? toEvent(row) : null;
  }

  async createPerformances(
    rows: NewPerformanceInput[],
    seatsFor: (performanceId: string) => NewSeatInput[]
  ): Promise<Performance[]> {
    try {
      return await this.db.transaction(async (tx: DbTransaction) => {
        const performanceRows = await tx
          .insert(schema.performancesTable)
          .values(
            rows.map((row) => ({
              id: row.performanceId,
              eventId: row.eventId,
              date: row.date,
              time: row.time,
              venue: row.venue,
              city: row.city,
              capacity: row.capacity,
            }))
          )
          .returning();

        const seatRows = rows.flatMap((row) => seatsFor(row.performanceId));
        if (seatRows.length > 0) {
          await tx.insert(schema.seatsTable).values(seatRows);
        }

        return performanceRows.map(toPerformance);
      });
    } catch (err) {
      // Closes the race EventAdminService's own pre-check (a plain read,
      // then a later separate insert) can't: two concurrent identical
      // requests can both pass that pre-check before either commits — the
      // database's `performances_scheduled_slot_unique` partial index is
      // what actually decides which one wins (same pattern as
      // DrizzleUserRepository.create's email-uniqueness handling). A
      // multi-row INSERT fails and rolls back entirely on any one row's
      // violation, so this also correctly catches a within-batch duplicate
      // that slipped past EventAdminService's own in-memory check.
      if (isScheduledSlotUniqueViolation(err)) {
        // The constraint violation alone doesn't identify which submitted
        // row collided — re-check each one against the now-committed state
        // (whatever raced us has already committed or rolled back by now)
        // purely to produce an accurate error; this lookup isn't part of
        // the race-closing logic, which is already done by this point.
        for (const row of rows) {
          const existing = await this.findScheduledPerformance(row.eventId, row.date, row.time, row.venue);
          if (existing) {
            throw new PerformanceAlreadyScheduledError(row.eventId, row.date, row.time, row.venue);
          }
        }
        // Fallback — shouldn't normally happen, but refuse rather than
        // silently swallowing a conflict we couldn't pinpoint.
        const first = rows[0];
        throw new PerformanceAlreadyScheduledError(first.eventId, first.date, first.time, first.venue);
      }
      throw err;
    }
  }

  async findScheduledPerformance(eventId: string, date: string, time: string, venue: string): Promise<Performance | null> {
    const rows = await this.db
      .select()
      .from(schema.performancesTable)
      .where(
        and(
          eq(schema.performancesTable.eventId, eventId),
          eq(schema.performancesTable.date, date),
          eq(schema.performancesTable.time, time),
          eq(schema.performancesTable.venue, venue),
          eq(schema.performancesTable.status, 'scheduled')
        )
      )
      .limit(1);
    return rows[0] ? toPerformance(rows[0]) : null;
  }

  async cancelPerformance(performanceId: string): Promise<'cancelled' | 'not_found' | 'has_sales'> {
    return this.db.transaction(async (tx: DbTransaction) => {
      // Locks the performance row first — this also serializes concurrent
      // cancel attempts on the same performance against each other, so two
      // simultaneous cancel requests can't both proceed past the checks
      // below at once.
      const [performanceRow] = await tx
        .select()
        .from(schema.performancesTable)
        .where(eq(schema.performancesTable.id, performanceId))
        .for('update');

      if (!performanceRow) {
        return 'not_found';
      }
      if (performanceRow.status === 'cancelled') {
        return 'cancelled';
      }

      // Locks every seat for this performance — deliberately unfiltered by
      // status, not just the currently-`sold` ones: the lock has to cover
      // every row that *could* become `sold` while we hold it, otherwise a
      // concurrent checkout could acquire its own row lock on a seat we
      // didn't include here (see DrizzleOrderRepository.createOrder's
      // lockSeatsForUpdate) and sell it in the gap between our read and our
      // write. Locking the full set first, then checking status in
      // application code, is what actually closes that race — a query that
      // pre-filters to `status = 'sold'` in its own WHERE clause would lock
      // nothing on a seat that's merely `available` right now, leaving the
      // exact same window open.
      const seatRows = await tx
        .select()
        .from(schema.seatsTable)
        .where(eq(schema.seatsTable.performanceId, performanceId))
        .for('update');

      if (seatRows.some((seat) => seat.status === 'sold')) {
        return 'has_sales';
      }

      await tx
        .update(schema.performancesTable)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(schema.performancesTable.id, performanceId));

      // No existing seat-queries.ts helper covers a by-performanceId bulk
      // update (everything there is keyed by an explicit seatIds array) —
      // this is a different access pattern with exactly one call site, so
      // it stays local here rather than being promoted to a shared helper.
      //
      // Includes `reserved`, not just `available`: a reserved seat is an
      // active, unpaid checkout hold (up to SeatLockManager's lock
      // duration). Leaving it alone would let that checkout still complete
      // and pay for a performance already marked cancelled — releasing the
      // hold here (clearing reservedBy/reservedUntil, matching the same
      // fields markSeatsSold/releaseSeatsForOrder clear on their own
      // status transitions) makes the subsequent order-creation attempt
      // fail with OrderSeatConflictError instead.
      await tx
        .update(schema.seatsTable)
        .set({ status: 'blocked', reservedBy: null, reservedUntil: null, updatedAt: new Date() })
        .where(
          and(
            eq(schema.seatsTable.performanceId, performanceId),
            inArray(schema.seatsTable.status, ['available', 'reserved'])
          )
        );

      return 'cancelled';
    });
  }
}
