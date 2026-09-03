import type { SeatDetailsDto, SeatStatus } from '@ticketing-system/shared';

export type { SeatStatus };

/**
 * A single bookable seat, as rendered by the Seats components. Same fields
 * as the shared `SeatDetailsDto` wire type, with `seatId` renamed to `id`
 * for component ergonomics — derived from it, not redeclared, so a change
 * to the API's actual response shape fails this package's type-check too
 * instead of silently drifting.
 */
export interface Seat extends Omit<SeatDetailsDto, 'seatId'> {
  id: string;
}

export interface SeatCardProps {
  seat: Seat;
  selected: boolean;
  onSelect: (seat: Seat) => void;
}

export interface SeatMapProps {
  seats: Seat[];
  selectedSeatIds: string[];
  onSeatSelect: (seat: Seat) => void;
}
