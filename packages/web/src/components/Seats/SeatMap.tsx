import type { Seat, SeatMapProps } from './types';
import { SeatCard } from './SeatCard';
import styles from './SeatMap.module.css';

/** Groups seats by row and sorts rows alphabetically, seats within a row by number. */
function groupByRow(seats: Seat[]): Array<[string, Seat[]]> {
  const rows = new Map<string, Seat[]>();
  for (const seat of seats) {
    const row = rows.get(seat.row);
    if (row) {
      row.push(seat);
    } else {
      rows.set(seat.row, [seat]);
    }
  }
  for (const row of rows.values()) {
    row.sort((a, b) => a.number - b.number);
  }
  return [...rows.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Renders a performance's seats grouped by row, delegating each seat to {@link SeatCard}. */
export function SeatMap({ seats, selectedSeatIds, onSeatSelect }: SeatMapProps) {
  return (
    <div className={styles.seatMap}>
      {groupByRow(seats).map(([row, rowSeats]) => (
        <div key={row} className={styles.row}>
          <span className={styles.rowLabel}>{row}</span>
          <div className={styles.seats}>
            {rowSeats.map((seat) => (
              <SeatCard
                key={seat.id}
                seat={seat}
                selected={selectedSeatIds.includes(seat.id)}
                onSelect={onSeatSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
