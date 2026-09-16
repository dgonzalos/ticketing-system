import { useNavigate } from 'react-router-dom';
import { EventSelector, EventsHero } from '../../components/Events';
import type { Event } from '../../components/Events';
import { useEvents } from '../../hooks/useEvents';
import styles from './EventsScreen.module.css';

/** Route container for `/`: fetches events and navigates to `/events/:eventId` on selection. */
export function EventsScreen() {
  const navigate = useNavigate();
  const { data: events = [], isLoading, error } = useEvents();

  const handleSelect = (event: Event) => navigate(`/events/${event.id}`);

  return (
    <div className={styles.screen}>
      {isLoading ? (
        <p className={styles.loading}>Loading events…</p>
      ) : error ? (
        <p className={styles.error}>Failed to load events: {(error as Error).message}</p>
      ) : (
        <>
          {events.length > 0 && <EventsHero event={events[0]} onSelect={handleSelect} />}
          <h2 className={styles.sectionHeading}>Now showing</h2>
          <EventSelector events={events} onSelect={handleSelect} />
        </>
      )}
    </div>
  );
}
