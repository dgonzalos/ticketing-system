import clsx from 'clsx';
import { Card } from '../ui';
import type { EventSelectorProps } from './types';
import cardListStyles from './CardList.module.css';
import styles from './EventSelector.module.css';

const POSTER_CLASSES = [styles.poster1, styles.poster2, styles.poster3];

/** Clickable grid of events. Loading/error/empty states are the caller's responsibility to trigger, not render. */
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
            {event.description && <p className={styles.description}>{event.description}</p>}
          </div>
        </Card>
      ))}
    </div>
  );
}
