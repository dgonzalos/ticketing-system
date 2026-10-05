import clsx from 'clsx';
import { formatShortDate } from '../../utils/dates';
import { arcPath, POSTER_VIEWBOX, posterArt } from './posterArt';
import type { PosterShape } from './posterArt';
import type { Event } from './types';
import styles from './EventPoster.module.css';

const TONE_CLASSES = { 1: styles.tone1, 2: styles.tone2, 3: styles.tone3 };

export interface EventPosterProps {
  event: Event;
  /** `card` for the events grid, `hero` for the larger featured banner. */
  size: 'card' | 'hero';
}

/** "3 dates", "Last date", or "Coming soon" when nothing is scheduled. */
function eyebrowFor({ nextPerformance, upcomingPerformanceCount }: Event): string {
  if (!nextPerformance) return 'Coming soon';
  return upcomingPerformanceCount === 1 ? 'Last date' : `${upcomingPerformanceCount} dates`;
}

function Shape({ shape }: { shape: PosterShape }) {
  switch (shape.kind) {
    case 'circle':
      return <circle cx={shape.cx} cy={shape.cy} r={shape.r} />;
    case 'rings':
      return (
        <>
          <circle cx={shape.cx} cy={shape.cy} r={shape.r} />
          <circle cx={shape.cx} cy={shape.cy} r={shape.r + shape.gap} />
        </>
      );
    case 'arc':
      return <path d={arcPath(shape)} />;
    case 'dots':
      return (
        <>
          {Array.from({ length: shape.count }, (_, i) => (
            <circle key={i} className={styles.dot} cx={shape.x + i * shape.spacing} cy={shape.y} r={shape.r} />
          ))}
        </>
      );
  }
}

/**
 * A generated, typographic event poster in the style of the design
 * prototype: eyebrow, the title in spaced capitals, the next date, and a
 * motif of outline circles and arcs generated from the event id (see
 * `posterArt`). Colours come from the theme's `--color-poster-*` tokens, so
 * all three themes restyle it with no changes here; the SVG strokes with
 * `currentColor`, never a `var()` in an attribute.
 *
 * Entirely decorative and `aria-hidden`: the card's own heading carries the
 * title, so a card's accessible name still starts with it. Capitals are
 * `text-transform` only, so the DOM text stays in normal case.
 */
export function EventPoster({ event, size }: EventPosterProps) {
  const { tone, shapes } = posterArt(event.id);

  return (
    // A span (grid via CSS), not a div: cards render the poster inside a <button>, which only allows phrasing content.
    <span className={clsx(styles.poster, styles[size], TONE_CLASSES[tone])} aria-hidden="true">
      <svg
        className={styles.motif}
        viewBox={`0 0 ${POSTER_VIEWBOX.width} ${POSTER_VIEWBOX.height}`}
        preserveAspectRatio="xMaxYMin slice"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        focusable="false"
      >
        {shapes.map((shape, i) => (
          <Shape key={i} shape={shape} />
        ))}
      </svg>
      <span className={styles.eyebrow}>{eyebrowFor(event)}</span>
      <span className={styles.title}>{event.title}</span>
      {event.nextPerformance && (
        <span className={styles.date}>Next {formatShortDate(event.nextPerformance.date)}</span>
      )}
    </span>
  );
}
