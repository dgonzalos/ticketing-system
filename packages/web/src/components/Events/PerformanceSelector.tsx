import clsx from 'clsx';
import { formatCents } from '../../utils/currency';
import { formatDateParts, formatPerformanceDateTime, formatTime } from '../../utils/dates';
import { Card } from '../ui';
import type { Performance, PerformanceSelectorProps } from './types';
import cardListStyles from './CardList.module.css';
import styles from './PerformanceSelector.module.css';

/** At or below this many seats left, a row says "Only N seats left". */
const LOW_AVAILABILITY_THRESHOLD = 10;

/**
 * No seat is free right now. Sold out only if none is in an unpaid checkout
 * hold either — held seats return when their 5-minute hold expires.
 */
function isSoldOut({ availableSeats, fromPriceCents, heldSeats }: Performance): boolean {
  return (availableSeats === 0 || fromPriceCents === null) && heldSeats === 0;
}

const NONE_FREE_TEXT = 'No seats free right now — check back in a few minutes';

/** Plain-text availability, used for both the visible line and the button's accessible name. */
function availabilityText(performance: Performance): string {
  const { availableSeats, fromPriceCents } = performance;
  if (isSoldOut(performance)) {
    return 'Sold out';
  }
  if (availableSeats === 0 || fromPriceCents === null) {
    return NONE_FREE_TEXT;
  }
  const from = `from ${formatCents(fromPriceCents)}`;
  if (availableSeats <= LOW_AVAILABILITY_THRESHOLD) {
    return `Only ${availableSeats} ${availableSeats === 1 ? 'seat' : 'seats'} left · ${from}`;
  }
  return `From ${formatCents(fromPriceCents)}`;
}

function Availability({ performance }: { performance: Performance }) {
  const { availableSeats, fromPriceCents } = performance;
  if (availableSeats === 0 || fromPriceCents === null) {
    return <p className={styles.availability}>{isSoldOut(performance) ? 'Sold out' : NONE_FREE_TEXT}</p>;
  }
  if (availableSeats <= LOW_AVAILABILITY_THRESHOLD) {
    return (
      <p className={styles.availability}>
        Only <span className={styles.lowCount}>{availableSeats}</span> {availableSeats === 1 ? 'seat' : 'seats'} left · from{' '}
        {formatCents(fromPriceCents)}
      </p>
    );
  }
  return <p className={styles.availability}>From {formatCents(fromPriceCents)}</p>;
}

/**
 * Clickable list of an event's upcoming performances. Loading/error/empty
 * states are the caller's responsibility.
 *
 * Each button gets an explicit `aria-label`: its visible content is a
 * calendar-style date block (month / day / weekday as separate elements)
 * that would otherwise read as "OCT 16 Fri 19:30 · …". A sold-out
 * performance is disabled — there's nothing to choose on its seat map. One
 * whose last seats are only *held* stays clickable: those holds expire.
 */
export function PerformanceSelector({ performances, onSelect }: PerformanceSelectorProps) {
  if (performances.length === 0) {
    return <p className={styles.empty}>No upcoming performances are scheduled for this event yet.</p>;
  }

  return (
    <div className={cardListStyles.list} role="group" aria-label="Performances">
      {performances.map((performance) => {
        const { weekday, day, month } = formatDateParts(performance.date);
        const soldOut = isSoldOut(performance);
        const label = `${formatPerformanceDateTime(performance.date, performance.time)}, ${performance.venue}, ${performance.city}, ${availabilityText(performance)}`;
        return (
          <Card
            key={performance.id}
            as="button"
            className={clsx(cardListStyles.item, styles.row, soldOut && styles.soldOut)}
            onClick={() => onSelect(performance)}
            disabled={soldOut}
            aria-disabled={soldOut || undefined}
            aria-label={label}
          >
            <span className={styles.dateBlock} aria-hidden="true">
              <span className={styles.month}>{month}</span>
              <span className={styles.day}>{day}</span>
              <span className={styles.weekday}>{weekday}</span>
            </span>
            <span className={styles.details}>
              <span className={styles.when}>
                {formatTime(performance.time)} · {performance.venue}, {performance.city}
              </span>
              <Availability performance={performance} />
            </span>
            {!soldOut && (
              <span className={styles.cta} aria-hidden="true">
                Choose seats →
              </span>
            )}
          </Card>
        );
      })}
    </div>
  );
}
