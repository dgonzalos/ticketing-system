import { Button } from '../ui';
import type { Event } from './types';
import styles from './EventsHero.module.css';

interface EventsHeroProps {
  event: Event;
  onSelect: (event: Event) => void;
}

/**
 * Featured-event banner at the top of the events list, sourced from the
 * design prototype (disenos-ticketera.html's hero section). Always features
 * the first event in the list — there's no "featured" flag on `EventDto`,
 * so this doesn't add a new API call.
 */
export function EventsHero({ event, onSelect }: EventsHeroProps) {
  return (
    <section className={styles.hero}>
      <div className={styles.copy}>
        <p className={styles.eyebrow}>Autumn season</p>
        <h2 className={styles.headline}>Your next night out starts here.</h2>
        <p className={styles.body}>Theatre, music, and nights you&rsquo;ll remember.</p>
        <Button onClick={() => onSelect(event)}>Discover {event.title} →</Button>
      </div>
      <div className={styles.poster} aria-hidden="true">
        <span className={styles.posterLetter}>{event.title.charAt(0)}</span>
      </div>
    </section>
  );
}
