/**
 * Seeds a handful of fictional events, performances, and seats for local
 * development and the public demo. Safe to re-run: clears existing catalog
 * data first (in FK-dependency order: order_items -> orders -> seats ->
 * performances -> events) before inserting. Orders/order_items must go first
 * since they reference seats — any orders placed against the previous seed
 * data would otherwise block deleting its seats. Never touches `users`, so
 * admin and demo accounts survive a re-seed.
 *
 * Performance dates are computed relative to the day the seed runs, so the
 * demo never offers past dates right after a re-seed — re-run it
 * periodically to keep them in the future.
 *
 * Usage:
 * ```
 * pnpm --filter @ticketing/api db:seed
 * ```
 */
import { db, pool } from './client.js';
import { eventsTable, orderItemsTable, ordersTable, performancesTable, seatsTable } from './schema/index.js';
import type { NewEvent, NewPerformance } from './schema/index.js';
import { generateSeatMap } from '../../domain/seats/seat-map.js';

/** Calendar date `n` days after today (local time), as `'YYYY-MM-DD'`. */
function daysFromToday(n: number): string {
  const date = new Date();
  date.setDate(date.getDate() + n);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

const events: NewEvent[] = [
  {
    id: 'event-1',
    title: 'The Lighthouse Keeper',
    description: 'A two-hander about the last night of a coastal lighthouse.',
    imageUrl: null,
  },
  {
    id: 'event-2',
    title: 'Midnight at the Alameda',
    description: 'A late-night jazz quartet in an old theatre bar.',
    imageUrl: null,
  },
  {
    id: 'event-3',
    title: 'Paper Orchestra',
    description: 'Chamber music played on instruments folded from paper.',
    imageUrl: null,
  },
  {
    id: 'event-4',
    title: 'Saltwater',
    description: 'A dance piece about the Mediterranean coast.',
    imageUrl: null,
  },
  {
    id: 'event-5',
    title: 'Everything Goes Wrong Tonight',
    description: 'A backstage farce where every cue misfires.',
    imageUrl: null,
  },
];

const ALAMEDA = { venue: 'Teatro Alameda', city: 'Madrid' };
const LLEVANT = { venue: 'Sala Llevant', city: 'Barcelona' };
const CAVE_AZUL = { venue: 'Cave Azul', city: 'Lisboa' };

// perf-1 is the first performance listed for event-1 — the e2e golden path
// clicks the first event card, then its first performance, then seat A1.
const performances: NewPerformance[] = [
  { id: 'perf-1', eventId: 'event-1', date: daysFromToday(12), time: '19:30:00', ...ALAMEDA, capacity: 100 },
  { id: 'perf-2', eventId: 'event-1', date: daysFromToday(13), time: '14:00:00', ...ALAMEDA, capacity: 100 },
  { id: 'perf-3', eventId: 'event-1', date: daysFromToday(40), time: '20:00:00', ...CAVE_AZUL, capacity: 100 },
  { id: 'perf-4', eventId: 'event-2', date: daysFromToday(15), time: '21:30:00', ...ALAMEDA, capacity: 100 },
  { id: 'perf-5', eventId: 'event-2', date: daysFromToday(22), time: '21:30:00', ...ALAMEDA, capacity: 100 },
  { id: 'perf-6', eventId: 'event-3', date: daysFromToday(18), time: '19:30:00', ...LLEVANT, capacity: 100 },
  { id: 'perf-7', eventId: 'event-3', date: daysFromToday(45), time: '14:00:00', ...LLEVANT, capacity: 100 },
  { id: 'perf-8', eventId: 'event-4', date: daysFromToday(25), time: '20:00:00', ...CAVE_AZUL, capacity: 100 },
  { id: 'perf-9', eventId: 'event-4', date: daysFromToday(26), time: '20:00:00', ...CAVE_AZUL, capacity: 100 },
  { id: 'perf-10', eventId: 'event-4', date: daysFromToday(52), time: '19:30:00', ...LLEVANT, capacity: 100 },
  { id: 'perf-11', eventId: 'event-5', date: daysFromToday(30), time: '20:00:00', ...LLEVANT, capacity: 100 },
  { id: 'perf-12', eventId: 'event-5', date: daysFromToday(58), time: '19:30:00', ...ALAMEDA, capacity: 100 },
];

async function seed(): Promise<void> {
  console.log('Seeding events/performances/seats...');

  await db.delete(orderItemsTable);
  await db.delete(ordersTable);
  await db.delete(seatsTable);
  await db.delete(performancesTable);
  await db.delete(eventsTable);

  await db.insert(eventsTable).values(events);
  await db.insert(performancesTable).values(performances);

  let totalSeats = 0;
  for (const performance of performances) {
    const seatMap = generateSeatMap(performance.id);
    await db.insert(seatsTable).values(seatMap);
    totalSeats += seatMap.length;
  }

  console.log(`✅ Seeded ${events.length} events, ${performances.length} performances, ${totalSeats} seats`);
}

seed()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Seed failed:', error);
    return pool.end().finally(() => process.exit(1));
  });
