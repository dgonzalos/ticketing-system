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
