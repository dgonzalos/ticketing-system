/**
 * Seeds a handful of realistic events, performances, and seats for local
 * development. Safe to re-run: clears existing catalog data first (in
 * FK-dependency order: seats -> performances -> events) before inserting.
 *
 * Usage:
 * ```
 * pnpm --filter @ticketing/api db:seed
 * ```
 */
import { db, pool } from './client.js';
import { eventsTable, performancesTable, seatsTable } from './schema/index.js';
import type { NewEvent, NewPerformance, NewSeat } from './schema/index.js';

const events: NewEvent[] = [
  {
    id: 'event-1',
    title: 'Hamilton',
    description: 'The story of America then, told by America now.',
    imageUrl: null,
  },
  {
    id: 'event-2',
    title: 'The Play That Goes Wrong',
    description: 'A murder-mystery farce where absolutely everything goes wrong.',
    imageUrl: null,
  },
  {
    id: 'event-3',
    title: 'An Evening of Jazz',
    description: 'A late-night jazz quartet set.',
    imageUrl: null,
  },
];

const performances: NewPerformance[] = [
  { id: 'perf-1', eventId: 'event-1', date: '2026-03-14', time: '19:30:00', venue: 'Orpheum Theatre', city: 'Seattle', capacity: 100 },
  { id: 'perf-2', eventId: 'event-1', date: '2026-03-15', time: '14:00:00', venue: 'Orpheum Theatre', city: 'Seattle', capacity: 100 },
  { id: 'perf-3', eventId: 'event-2', date: '2026-04-02', time: '20:00:00', venue: 'Paramount Theatre', city: 'Seattle', capacity: 100 },
  { id: 'perf-4', eventId: 'event-2', date: '2026-04-03', time: '20:00:00', venue: 'Paramount Theatre', city: 'Seattle', capacity: 100 },
  { id: 'perf-5', eventId: 'event-3', date: '2026-05-10', time: '21:00:00', venue: 'Blue Note', city: 'New York', capacity: 100 },
];

const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const SEATS_PER_ROW = 10;

/** Price in cents, banded by row: A-C premium, D-G standard, H-J economy. */
function zoneAndPrice(row: string): { zone: string; price: number } {
  if (row <= 'C') return { zone: 'premium', price: 15000 };
  if (row <= 'G') return { zone: 'standard', price: 9000 };
  return { zone: 'economy', price: 5000 };
}

function seatsForPerformance(performanceId: string): NewSeat[] {
  return ROWS.flatMap((row) => {
    const { zone, price } = zoneAndPrice(row);
    return Array.from({ length: SEATS_PER_ROW }, (_, i) => {
      const number = i + 1;
      return {
        id: `${performanceId}-${row}${number}`,
        performanceId,
        row,
        number,
        zone,
        price,
      } satisfies NewSeat;
    });
  });
}

async function seed(): Promise<void> {
  console.log('Seeding events/performances/seats...');

  await db.delete(seatsTable);
  await db.delete(performancesTable);
  await db.delete(eventsTable);

  await db.insert(eventsTable).values(events);
  await db.insert(performancesTable).values(performances);

  for (const performance of performances) {
    await db.insert(seatsTable).values(seatsForPerformance(performance.id));
  }

  const totalSeats = performances.length * ROWS.length * SEATS_PER_ROW;
  console.log(`✅ Seeded ${events.length} events, ${performances.length} performances, ${totalSeats} seats`);
}

seed()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Seed failed:', error);
    return pool.end().finally(() => process.exit(1));
  });
