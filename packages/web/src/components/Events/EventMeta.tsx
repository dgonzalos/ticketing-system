import clsx from 'clsx';
import { formatCents } from '../../utils/currency';
import { formatShortDate } from '../../utils/dates';
import type { Event } from './types';
import styles from './EventMeta.module.css';

interface EventMetaProps {
  event: Event;
  /** Append "· from 50,00 €" — for the hero, which has no separate price footer like the cards do. */
  withPrice?: boolean;
  className?: string;
}

/**
 * One-line "when and where" for an event: its next date and venue, plus
 * "+N more dates" when there are more — or "Dates coming soon" when nothing
 * is scheduled. Shared by the event cards and the hero so the two can't
 * describe the same event differently.
 */
export function EventMeta({ event, withPrice = false, className }: EventMetaProps) {
  const next = event.nextPerformance;
  if (!next) {
    return <p className={clsx(styles.meta, className)}>Dates coming soon</p>;
  }

  const moreDates = event.upcomingPerformanceCount - 1;
  return (
    <p className={clsx(styles.meta, className)}>
      {formatShortDate(next.date)} · {next.venue}, {next.city}
      {moreDates > 0 && <span className={styles.more}> · +{moreDates} more {moreDates === 1 ? 'date' : 'dates'}</span>}
      {withPrice && event.fromPriceCents !== null && (
        <span className={styles.more}> · from {formatCents(event.fromPriceCents)}</span>
      )}
    </p>
  );
}
