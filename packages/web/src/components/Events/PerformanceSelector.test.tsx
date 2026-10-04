import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PerformanceSelector } from './PerformanceSelector';
import type { Performance } from './types';

/** testing-library collapses the NBSP Intl puts before "€" (see CLAUDE.md "Currency formatting"). */
const nbsp = (text: string | null) => (text ?? '').replace(/ /g, ' ');

const performance: Performance = {
  id: 'perf-1',
  eventId: 'event-1',
  date: '2026-10-16',
  time: '19:30:00',
  venue: 'Teatro Alameda',
  city: 'Madrid',
  capacity: 100,
  availableSeats: 40,
  fromPriceCents: 5000,
  heldSeats: 0,
};

function renderRows(performances: Performance[], onSelect = vi.fn()) {
  render(<PerformanceSelector performances={performances} onSelect={onSelect} />);
  return within(screen.getByRole('group', { name: 'Performances' })).getAllByRole('button');
}

describe('PerformanceSelector', () => {
  it('gives each row a readable accessible name, not the date block read piece by piece', () => {
    const [row] = renderRows([performance]);

    expect(nbsp(row.getAttribute('aria-label'))).toBe('Fri 16 October 2026, 19:30, Teatro Alameda, Madrid, From 50,00 €');
  });

  it('shows the date block, time and venue, and the from-price when plenty of seats are left', () => {
    const [row] = renderRows([performance]);

    expect(row.textContent).toContain('Oct');
    expect(row.textContent).toContain('16');
    expect(row.textContent).toContain('Fri');
    expect(row.textContent).toContain('19:30 · Teatro Alameda, Madrid');
    expect(nbsp(row.textContent)).toContain('From 50,00 €');
    expect(row.textContent).not.toContain('left');
  });

  it('warns when 10 or fewer seats are left', () => {
    const [row] = renderRows([{ ...performance, availableSeats: 4, fromPriceCents: 9000 }]);

    expect(nbsp(row.textContent)).toContain('Only 4 seats left · from 90,00 €');
    expect(nbsp(row.getAttribute('aria-label'))).toContain('Only 4 seats left · from 90,00 €');
  });

  it('uses the singular for one seat left', () => {
    const [row] = renderRows([{ ...performance, availableSeats: 1 }]);

    expect(row.textContent).toContain('Only 1 seat left');
  });

  it('disables a sold-out row and says so', async () => {
    const onSelect = vi.fn();
    const [row] = renderRows([{ ...performance, availableSeats: 0, fromPriceCents: null }], onSelect);

    expect(row).toBeDisabled();
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(row.getAttribute('aria-label')).toMatch(/, Sold out$/);
    expect(row.textContent).not.toContain('Choose seats');

    await userEvent.click(row);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps a row whose last seats are only held clickable, and says they may free up', async () => {
    const onSelect = vi.fn();
    const [row] = renderRows([{ ...performance, availableSeats: 0, fromPriceCents: null, heldSeats: 3 }], onSelect);

    expect(row).toBeEnabled();
    expect(row.textContent).toContain('No seats free right now — check back in a few minutes');
    expect(row.getAttribute('aria-label')).toMatch(/, No seats free right now — check back in a few minutes$/);

    await userEvent.click(row);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('selects an available row', async () => {
    const onSelect = vi.fn();
    const [row] = renderRows([performance], onSelect);

    await userEvent.click(row);

    expect(onSelect).toHaveBeenCalledWith(performance);
  });

  it('explains when nothing upcoming is scheduled', () => {
    render(<PerformanceSelector performances={[]} onSelect={vi.fn()} />);

    expect(screen.getByText('No upcoming performances are scheduled for this event yet.')).toBeInTheDocument();
  });
});
