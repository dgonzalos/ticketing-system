import { formatPerformanceDateTime } from '../../utils/dates';
import { Card } from '../ui';
import type { PerformanceSelectorProps } from './types';
import cardListStyles from './CardList.module.css';
import styles from './PerformanceSelector.module.css';

/** Clickable list of performances scheduled for one event. Loading/error/empty states are the caller's responsibility. */
export function PerformanceSelector({ performances, onSelect }: PerformanceSelectorProps) {
  if (performances.length === 0) {
    return <p className={styles.empty}>No performances are scheduled for this event yet.</p>;
  }

  return (
    <div className={cardListStyles.list} role="group" aria-label="Performances">
      {performances.map((performance) => (
        <Card key={performance.id} as="button" className={cardListStyles.item} onClick={() => onSelect(performance)}>
          <h3 className={styles.dateTime}>{formatPerformanceDateTime(performance.date, performance.time)}</h3>
          <p className={styles.venue}>
            {performance.venue}, {performance.city}
          </p>
        </Card>
      ))}
    </div>
  );
}
