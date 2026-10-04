import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EventSelector } from './EventSelector';
import type { Event } from './types';

/** testing-library collapses the NBSP Intl puts before "€" (see CLAUDE.md "Currency formatting"). */
const nbsp = (text: string | null) => (text ?? '').replace(/ /g, ' ');

const event: Event = {
  id: 'event-1',
  title: 'The Lighthouse Keeper',
  description: 'A two-hander about the last night of a coastal lighthouse.',
  imageUrl: null,
  nextPerformance: { date: '2026-10-16', time: '19:30:00', venue: 'Teatro Alameda', city: 'Madrid' },
  upcomingPerformanceCount: 3,
  fromPriceCents: 5000,
  heldSeats: 0,
};

function cardFor(title: string) {
  return screen.getByRole('button', { name: new RegExp(`^${title}`) });
}

describe('EventSelector', () => {
  it('shows the next date, venue, extra dates, and from-price', () => {
    render(<EventSelector events={[event]} onSelect={vi.fn()} />);

    const card = cardFor('The Lighthouse Keeper');
    expect(nbsp(card.textContent)).toContain('16 Oct · Teatro Alameda, Madrid · +2 more dates');
    expect(nbsp(card.textContent)).toContain('From 50,00 €');
    expect(within(card).getByText('View dates →')).toBeInTheDocument();
  });

  it('keeps the title first in the accessible name', () => {
    render(<EventSelector events={[event]} onSelect={vi.fn()} />);

    expect(cardFor('The Lighthouse Keeper')).toBeInTheDocument();
  });

  it('says "+1 more date" in the singular', () => {
    render(<EventSelector events={[{ ...event, upcomingPerformanceCount: 2 }]} onSelect={vi.fn()} />);

    expect(cardFor('The Lighthouse Keeper').textContent).toContain('+1 more date');
    expect(cardFor('The Lighthouse Keeper').textContent).not.toContain('more dates');
  });

  it('shows "Sold out" instead of a price, and stays clickable', async () => {
    const onSelect = vi.fn();
    render(<EventSelector events={[{ ...event, fromPriceCents: null }]} onSelect={onSelect} />);

    const card = cardFor('The Lighthouse Keeper');
    expect(within(card).getByText('Sold out')).toBeInTheDocument();
    expect(card.textContent).not.toContain('From');

    await userEvent.click(card);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('says "No seats free right now" rather than sold out when the last seats are only held', () => {
    render(<EventSelector events={[{ ...event, fromPriceCents: null, heldSeats: 2 }]} onSelect={vi.fn()} />);

    const card = cardFor('The Lighthouse Keeper');
    expect(within(card).getByText('No seats free right now')).toBeInTheDocument();
    expect(card.textContent).not.toContain('Sold out');
  });

  it('shows "Dates coming soon" and no price row when nothing is scheduled', () => {
    render(
      <EventSelector
        events={[{ ...event, nextPerformance: null, upcomingPerformanceCount: 0, fromPriceCents: null }]}
        onSelect={vi.fn()}
      />
    );

    const card = cardFor('The Lighthouse Keeper');
    expect(within(card).getByText('Dates coming soon')).toBeInTheDocument();
    expect(card.textContent).not.toContain('Sold out');
    expect(card.textContent).not.toContain('View dates');
  });
});
