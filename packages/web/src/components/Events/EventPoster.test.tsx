import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EventPoster } from './EventPoster';
import type { Event } from './types';

const event: Event = {
  id: 'event-1',
  title: 'The Lighthouse Keeper',
  description: null,
  imageUrl: null,
  nextPerformance: { date: '2026-10-16', time: '19:30:00', venue: 'Teatro Alameda', city: 'Madrid' },
  upcomingPerformanceCount: 3,
  fromPriceCents: 5000,
  heldSeats: 0,
};

function renderPoster(overrides: Partial<Event> = {}) {
  const { container } = render(<EventPoster event={{ ...event, ...overrides }} size="card" />);
  return container.firstElementChild as HTMLElement;
}

describe('EventPoster', () => {
  it('is decorative: hidden from assistive tech, with an svg motif', () => {
    const poster = renderPoster();

    expect(poster).toHaveAttribute('aria-hidden', 'true');
    expect(poster.querySelector('svg')).not.toBeNull();
  });

  it('shows the date count, title, and next date', () => {
    const poster = renderPoster();

    expect(poster.textContent).toContain('3 dates');
    expect(poster.textContent).toContain('The Lighthouse Keeper');
    expect(poster.textContent).toContain('Next 16 Oct');
  });

  it('says "Last date" when one performance is left', () => {
    expect(renderPoster({ upcomingPerformanceCount: 1 }).textContent).toContain('Last date');
  });

  it('says "Coming soon" and shows no date when nothing is scheduled', () => {
    const poster = renderPoster({ nextPerformance: null, upcomingPerformanceCount: 0 });

    expect(poster.textContent).toContain('Coming soon');
    expect(poster.textContent).not.toContain('Next');
  });

  it('renders the same motif for the same event', () => {
    const first = renderPoster().querySelector('svg')?.innerHTML;
    const second = renderPoster().querySelector('svg')?.innerHTML;

    expect(first).toBe(second);
  });
});
