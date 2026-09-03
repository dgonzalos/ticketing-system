import type { SeatCardProps, SeatStatus } from './types';
import styles from './SeatCard.module.css';

const STATUS_LABEL: Record<SeatStatus, string> = {
  available: 'Available',
  reserved: 'Reserved',
  sold: 'Sold',
  blocked: 'Unavailable',
};

/** A single clickable seat. Selectable only while `available` (or already selected, to allow deselecting). */
export function SeatCard({ seat, selected, onSelect }: SeatCardProps) {
  const disabled = seat.status !== 'available' && !selected;

  return (
    <button
      type="button"
      className={`${styles.seat} ${styles[seat.status] ?? ''} ${selected ? styles.selected : ''}`}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`Seat ${seat.row}${seat.number}, ${STATUS_LABEL[seat.status] ?? seat.status}, $${(seat.price / 100).toFixed(2)}`}
      onClick={() => onSelect(seat)}
    >
      <span className={styles.label}>
        {seat.row}
        {seat.number}
      </span>
      <span className={styles.price}>${(seat.price / 100).toFixed(2)}</span>
    </button>
  );
}
