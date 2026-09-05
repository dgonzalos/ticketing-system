import { useNavigate } from 'react-router-dom';
import { EventSelector } from '../../components/Events';
import type { Event } from '../../components/Events';
import { useEvents } from '../../hooks/useEvents';
import styles from './EventsScreen.module.css';

/** Route container for `/`: fetches events and navigates to `/events/:eventId` on selection. */
export function EventsScreen() {
  const navigate = useNavigate();
  const { data: events = [], isLoading, error } = useEvents();

  if (isLoading) {
    return <p className={styles.loading}>Loading events…</p>;
  }

  if (error) {
    return <p className={styles.error}>Failed to load events: {(error as Error).message}</p>;
  }

  const handleSelect = (event: Event) => navigate(`/events/${event.id}`);

  return <EventSelector events={events} onSelect={handleSelect} />;
}
