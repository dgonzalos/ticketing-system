import { useNavigate, useParams } from 'react-router-dom';
import { PerformanceSelector } from '../../components/Events';
import type { Performance } from '../../components/Events';
import { BackLink, LoadingState, PageHeader, Skeleton } from '../../components/ui';
import { useEvents } from '../../hooks/useEvents';
import { usePerformances } from '../../hooks/usePerformances';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { NotFoundScreen } from '../NotFoundScreen';
import styles from './PerformancesScreen.module.css';

/** Route container for `/events/:eventId`: fetches that event's performances and navigates to the seat map on selection. */
export function PerformancesScreen() {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const { data: events = [], isSuccess: eventsLoaded } = useEvents();
  const { data: performances = [], isLoading, error } = usePerformances(eventId);

  const event = events.find((e) => e.id === eventId);
  // An unknown event id (most often an old link after a re-seed) is a missing page, not a failed request.
  const notFound = eventsLoaded && !event;
  // Set here for the 404 case too: this effect runs after NotFoundScreen's own, so it would otherwise overwrite it.
  useDocumentTitle(notFound ? 'Page not found' : event?.title);
  const handleSelect = (performance: Performance) => navigate(`/events/${eventId}/performances/${performance.id}`);

  if (notFound) {
    return <NotFoundScreen />;
  }

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
        <LoadingState className={styles.skeletonList}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height="5.5rem" radius="card" />
          ))}
        </LoadingState>
      ) : error ? (
        <p className={styles.error}>Failed to load performances: {(error as Error).message}</p>
      ) : (
        <PerformanceSelector performances={performances} onSelect={handleSelect} />
      )}
    </div>
  );
}
