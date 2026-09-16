import { useNavigate, useParams } from 'react-router-dom';
import { PerformanceSelector } from '../../components/Events';
import type { Performance } from '../../components/Events';
import { BackLink, PageHeader } from '../../components/ui';
import { useEvents } from '../../hooks/useEvents';
import { usePerformances } from '../../hooks/usePerformances';
import styles from './PerformancesScreen.module.css';

/** Route container for `/events/:eventId`: fetches that event's performances and navigates to the seat map on selection. */
export function PerformancesScreen() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const { data: events = [] } = useEvents();
  const { data: performances = [], isLoading, error } = usePerformances(eventId);

  const event = events.find((e) => e.id === eventId);
  const handleSelect = (performance: Performance) => navigate(`/events/${eventId}/performances/${performance.id}`);

  return (
    <div className={styles.screen}>
      <BackLink to="/">Back to events</BackLink>
      {event && (
        <PageHeader
          title={event.title}
          description={event.description ?? 'Choose a date and time for your visit.'}
        />
      )}
      {isLoading ? (
        <p className={styles.loading}>Loading performances…</p>
      ) : error ? (
        <p className={styles.error}>Failed to load performances: {(error as Error).message}</p>
      ) : (
        <PerformanceSelector performances={performances} onSelect={handleSelect} />
      )}
    </div>
  );
}
