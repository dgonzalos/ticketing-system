import type { OrderSeatSummary } from './types';
import styles from './SeatsSummaryList.module.css';

interface SeatsSummaryListProps {
  seats: OrderSeatSummary[];
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Read-only list of seats with their price, shared by the checkout and order-confirmation screens. */
export function SeatsSummaryList({ seats }: SeatsSummaryListProps) {
  return (
    <ul className={styles.list}>
      {seats.map((seat) => (
        <li key={seat.seatId} className={styles.row}>
          <span>
            {seat.row !== undefined && seat.number !== undefined ? `${seat.row}${seat.number}` : seat.seatId}
            {seat.zone && <span className={styles.zone}> · {seat.zone}</span>}
          </span>
          <span>{formatCents(seat.price)}</span>
        </li>
      ))}
    </ul>
  );
}
