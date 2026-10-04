import clsx from 'clsx';
import { formatCents } from '../../utils/currency';
import { Card } from '../ui';
import { EventMeta } from './EventMeta';
import type { Event, EventSelectorProps } from './types';
import cardListStyles from './CardList.module.css';
import styles from './EventSelector.module.css';

const POSTER_CLASSES = [styles.poster1, styles.poster2, styles.poster3];

/** Footer price line: "From 50,00 €", "Sold out", or nothing when no dates are scheduled. */
function EventPrice({ event }: { event: Event }) {
  if (!event.nextPerformance) {
    return null;
  }
  return (
    <div className={styles.footer}>
      {event.fromPriceCents === null ? (
        // Held seats (unpaid 5-minute checkout holds) come back when they expire — not sold out.
        <span className={styles.soldOut}>{event.heldSeats > 0 ? 'No seats free right now' : 'Sold out'}</span>
      ) : (
        <span className={styles.price}>From {formatCents(event.fromPriceCents)}</span>
      )}
      <span className={styles.cta}>View dates →</span>
    </div>
  );
}

/**
 * Clickable grid of events. Loading/error/empty states are the caller's
 * responsibility to trigger, not render.
 *
 * The title stays the first text in each card: a card's accessible name is
 * all of its text joined, and the e2e (and screen-reader users) identify a
 * card by what it starts with. A sold-out event stays clickable — its dates
 * page explains, and some dates may free up.
 */
export function EventSelector({ events, onSelect }: EventSelectorProps) {
  if (events.length === 0) {
    return <p className={styles.empty}>No events are on sale right now.</p>;
  }

  return (
    <div className={styles.grid}>
      {events.map((event, index) => (
        <Card
          key={event.id}
          as="button"
          className={clsx(cardListStyles.item, styles.card)}
          onClick={() => onSelect(event)}
        >
          <div className={clsx(styles.poster, POSTER_CLASSES[index % 3])} aria-hidden="true">
            {event.title.charAt(0)}
          </div>
          <div className={styles.body}>
            <h3 className={styles.title}>{event.title}</h3>
            <EventMeta event={event} />
            {event.description && <p className={styles.description}>{event.description}</p>}
            <EventPrice event={event} />
          </div>
        </Card>
      ))}
    </div>
  );
}
