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

/** Request body for the API's `POST /admin/events`. */
export interface CreateEventRequestDto {
  title: string;
  description?: string | null;
  imageUrl?: string | null;
}

/** Request body for the API's `PATCH /admin/events/:eventId`. */
export interface UpdateEventRequestDto {
  title?: string;
  description?: string | null;
  imageUrl?: string | null;
}

/** Request body for the API's `POST /admin/events/:eventId/performances`. */
export interface CreatePerformancesRequestDto {
  performances: Array<{
    /** Calendar date, `'YYYY-MM-DD'`. */
    date: string;
    /** Start time, `'HH:MM:SS'`. */
    time: string;
    venue: string;
    city: string;
    /** Informational only — does not affect actual seat generation. */
    capacity?: number;
  }>;
}

/** Wire shape returned by the API's `POST /admin/performances/:performanceId/cancel`. */
export interface CancelPerformanceResponseDto {
  performanceId: string;
  status: 'cancelled';
}

/** Lifecycle state of an order. */
export type OrderStatus = 'pending' | 'payment_processing' | 'completed' | 'cancelled';

/** A single seat within an order, as returned by the API. */
export interface OrderItemDto {
  seatId: string;
  /** Price in cents, snapshotted from the seat at the moment of purchase. */
  price: number;
}

/**
 * Wire shape of an order as returned by the API's `POST /orders` and
 * `GET /orders/:orderId` (see `packages/api/src/api/routes/orders.ts`).
 */
export interface OrderDto {
  id: string;
  userId: string;
  email: string;
  performanceId: string;
  status: OrderStatus;
  /** Total charged, in cents. */
  totalAmount: number;
  items: OrderItemDto[];
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/** Request body for the API's `POST /orders`. */
export interface CreateOrderRequestDto {
  performanceId: string;
  seatIds: string[];
  /** Total the client believes it's paying, in cents — the server recalculates and rejects on mismatch. */
  totalAmount: number;
  email: string;
}

/**
 * Wire shape returned by the API's `POST /orders/:orderId/payment-session`
 * (see `packages/api/src/api/routes/payments.ts`). `paymentUrl` is a real
 * Stripe-hosted Checkout URL — the client should do a full browser
 * redirect (`window.location.href = paymentUrl`), not client-side routing.
 */
export interface PaymentSessionResponseDto {
  paymentUrl: string;
  orderId: string;
  status: 'payment_processing';
}

/**
 * Wire shape returned by the API's `GET /orders/:orderId/payment-status`
 * (see `packages/api/src/api/routes/payments.ts`). Polled by the frontend
 * while a Stripe webhook settles payment asynchronously.
 */
export interface PaymentStatusResponseDto {
  status: OrderStatus;
  /** Total charged, in cents. */
  totalAmount: number;
}

/**
 * Wire shape of a user as returned by the API's `POST /auth/signup` and
 * `POST /auth/login` (see `packages/api/src/api/routes/auth.ts`).
 */
export interface UserDto {
  id: string;
  email: string;
  name: string | null;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** Authorization role — `admin` accounts are only ever granted via `seed-admin.ts`. */
  role: 'customer' | 'admin';
}

/** Request body for the API's `POST /auth/signup`. */
export interface SignupRequestDto {
  email: string;
  /** Minimum 8 characters, checked server-side. */
  password: string;
  /** Must match `password` — checked server-side. */
  passwordConfirm: string;
}

/** Request body for the API's `POST /auth/login`. */
export interface LoginRequestDto {
  email: string;
  password: string;
}

/** Wire shape returned by both `POST /auth/signup` and `POST /auth/login`. */
export interface AuthResponseDto {
  user: UserDto;
  token: string;
}
