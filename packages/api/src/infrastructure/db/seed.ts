/**
 * Seeds a handful of realistic events, performances, and seats for local
 * development. Safe to re-run: clears existing catalog data first (in
 * FK-dependency order: order_items -> orders -> seats -> performances ->
 * events) before inserting. Orders/order_items must go first since they
 * reference seats — any orders placed against the previous seed data would
 * otherwise block deleting its seats.
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
