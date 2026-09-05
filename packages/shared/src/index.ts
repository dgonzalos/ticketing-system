/**
 * Cross-package contracts shared between `@ticketing/api` and
 * `@ticketing-system/web`. Types only, by design: this package has no build
 * step and is consumed exclusively via `import type`, which TypeScript
 * erases at compile time — neither `tsc` (api) nor Vite/esbuild (web) ever
 * needs to load it as real JS at runtime. Do not add runtime code or values
 * here without also adding a real build step for this package.
 */

/** Lifecycle state of a seat. */
export type SeatStatus = 'available' | 'reserved' | 'sold' | 'blocked';

/**
 * Wire shape of a seat as returned by the API's `GET /seats` (see
 * `packages/api/src/api/routes/seats.ts`). Intentionally omits
 * `reservedBy` — that route is public (no auth), and who holds a
 * reservation must not be enumerable by an anonymous caller.
 */
export interface SeatDetailsDto {
  seatId: string;
  performanceId: string;
  row: string;
  number: number;
  zone: string;
  /** Price in cents (e.g. `5000` = $50.00). */
  price: number;
  status: SeatStatus;
  /** ISO 8601 timestamp, or null if not currently reserved. */
  reservedUntil: string | null;
}

/**
 * Wire shape of an event as returned by the API's `GET /events` (see
 * `packages/api/src/api/routes/events.ts`).
 */
export interface EventDto {
  eventId: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
}

/**
 * Wire shape of a performance as returned by the API's
 * `GET /events/:eventId/performances`.
 */
export interface PerformanceDto {
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
