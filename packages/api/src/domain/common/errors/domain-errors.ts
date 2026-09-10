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

/**
 * Thrown on signup when the (normalized) email is already registered to
 * another account. The message deliberately omits the email — it is sent
 * verbatim to the client on a 409, and echoing the submitted value back
 * would be an avoidable enumeration/reflection leak.
 */
export class EmailAlreadyRegisteredError extends DomainError {
  constructor(public readonly email: string) {
    super('Email already registered');
  }
}

/**
 * Thrown on login when the email doesn't match any account, or the password
 * doesn't match that account's hash. Deliberately a single error for both
 * cases — the two must always be indistinguishable to the caller (same
 * status, same message) to avoid leaking which emails have accounts.
 */
export class InvalidCredentialsError extends DomainError {
  constructor() {
    super('Invalid email or password');
  }
}

/**
 * Thrown when an admin tries to schedule a performance that duplicates an
 * existing scheduled performance for the same event/date/time/venue — or
 * duplicates another performance within the same submitted batch.
 */
export class PerformanceAlreadyScheduledError extends DomainError {
  constructor(
    public readonly eventId: string,
    public readonly date: string,
    public readonly time: string,
    public readonly venue: string
  ) {
    super(`A performance already exists for event ${eventId} on ${date} at ${time} at ${venue}`);
  }
}

/**
 * Thrown when an admin tries to cancel a performance that has sold seats.
 * Refusing is correct: cancelling would mean refunding real Stripe
 * payments, and no refund path exists yet — see
 * `EventAdminService.cancelPerformance`.
 */
export class PerformanceHasSalesError extends DomainError {
  constructor(public readonly performanceId: string) {
    super(`Performance ${performanceId} has sold seats and cannot be cancelled`);
  }
}

/** Thrown when a Stripe Checkout session cannot be created for an order. */
export class PaymentInitiationError extends DomainError {
  constructor(public readonly orderId: string, cause?: unknown) {
    super(`Failed to initiate payment for order: ${orderId}`);
    this.cause = cause;
  }
}

/**
 * Thrown when a Stripe Checkout session's payment status can't be verified
 * as paid, or its `metadata.orderId` doesn't match the order it's being
 * applied to.
 */
export class PaymentVerificationError extends DomainError {
  constructor(public readonly sessionId: string, public readonly orderId: string) {
    super(`Could not verify payment for order ${orderId} (session ${sessionId})`);
  }
}
