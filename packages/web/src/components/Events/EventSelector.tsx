import { Card } from '../ui';
import type { EventSelectorProps } from './types';
import cardListStyles from './CardList.module.css';
import styles from './EventSelector.module.css';

/** Clickable list of events. Loading/error/empty states are the caller's responsibility to trigger, not render. */
export function EventSelector({ events, onSelect }: EventSelectorProps) {
  if (events.length === 0) {
    return <p className={styles.empty}>No events are on sale right now.</p>;
  }

  return (
    <div className={cardListStyles.list}>
      {events.map((event) => (
        <Card key={event.id} as="button" className={cardListStyles.item} onClick={() => onSelect(event)}>
          <h3 className={styles.title}>{event.title}</h3>
          {event.description && <p className={styles.description}>{event.description}</p>}
        </Card>
      ))}
    </div>
  );
}
