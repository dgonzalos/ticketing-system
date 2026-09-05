import { Card } from '../ui';
import type { Performance, PerformanceSelectorProps } from './types';
import cardListStyles from './CardList.module.css';
import styles from './PerformanceSelector.module.css';

const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};

/** Formats a performance's `date` ('YYYY-MM-DD') + `time` ('HH:MM:SS') as e.g. "Sat, March 14, 2026, 7:30 PM". */
function formatDateTime(performance: Performance): string {
  const date = new Date(`${performance.date}T${performance.time}`);
  return new Intl.DateTimeFormat(undefined, DATE_TIME_FORMAT).format(date);
}

/** Clickable list of performances scheduled for one event. Loading/error/empty states are the caller's responsibility. */
export function PerformanceSelector({ performances, onSelect }: PerformanceSelectorProps) {
  if (performances.length === 0) {
    return <p className={styles.empty}>No performances are scheduled for this event yet.</p>;
  }

  return (
    <div className={cardListStyles.list}>
      {performances.map((performance) => (
        <Card key={performance.id} as="button" className={cardListStyles.item} onClick={() => onSelect(performance)}>
          <h3 className={styles.dateTime}>{formatDateTime(performance)}</h3>
          <p className={styles.venue}>
            {performance.venue}, {performance.city}
          </p>
        </Card>
      ))}
    </div>
  );
}
