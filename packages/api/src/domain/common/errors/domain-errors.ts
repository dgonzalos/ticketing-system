/** Base class for all domain-layer errors. */
export abstract class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Thrown when an operation targets a seat that does not exist. */
export class SeatNotFoundError extends DomainError {
  constructor(public readonly seatId: string) {
    super(`Seat not found: ${seatId}`);
  }
}

/**
 * Thrown when a caller attempts to unlock or confirm a seat they do not
 * currently hold the reservation for (including an expired reservation).
 */
export class SeatLockOwnershipError extends DomainError {
  constructor(public readonly seatId: string, public readonly userId: string) {
    super(`Seat lock expired or was taken by another user: ${seatId}`);
  }
}

/** Thrown when an operation targets an event that does not exist. */
export class EventNotFoundError extends DomainError {
  constructor(public readonly eventId: string) {
    super(`Event not found: ${eventId}`);
  }
}

/** Thrown when an order is placed against a performance that does not exist. */
export class PerformanceNotFoundError extends DomainError {
  constructor(public readonly performanceId: string) {
    super(`Performance not found: ${performanceId}`);
  }
}

/**
 * Thrown when an order references a seat that does not exist, or that
 * exists but belongs to a different performance than the one specified.
 */
export class OrderSeatNotFoundError extends DomainError {
  constructor(public readonly seatId: string) {
    super(`Seat not found: ${seatId}`);
  }
}

/**
 * Thrown when an order references a seat that is currently reserved by a
 * different user. An expired reservation — even one that was originally the
 * purchasing user's own — is {@link OrderSeatConflictError} instead, not
 * this: ownership is checked before expiry, so "not reserved by this user"
 * and "reservation expired" are always distinguishable.
 */
export class OrderSeatOwnershipError extends DomainError {
  constructor(public readonly seatId: string, public readonly userId: string) {
    super(`Seat is not reserved by this user: ${seatId}`);
  }
}

/**
 * Thrown when an order references a seat that is not in a purchasable
 * state — already sold, blocked, or its reservation has expired.
 */
export class OrderSeatConflictError extends DomainError {
  constructor(public readonly seatId: string) {
    super(`Seat is no longer available for purchase: ${seatId}`);
  }
}

/**
 * Thrown when the client-submitted total doesn't match the total
 * recalculated server-side from current seat prices.
 */
export class OrderPriceMismatchError extends DomainError {
  constructor(public readonly expected: number, public readonly submitted: number) {
    super(`Price mismatch: recalculated total ${expected} does not match submitted total ${submitted}`);
  }
}
