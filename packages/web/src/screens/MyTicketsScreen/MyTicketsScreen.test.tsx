import { screen, within } from '@testing-library/react';
import type { OrderSummaryDto } from '@ticketing-system/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/test-utils';
import { MyTicketsScreen } from './MyTicketsScreen';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    token: 'test-token',
    user: { id: 'user-1', email: 'buyer@example.com', name: null, createdAt: '2026-01-01T00:00:00.000Z', role: 'customer' },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

vi.mock('../../services/orderApi');
import * as orderApi from '../../services/orderApi';

/** testing-library collapses the NBSP Intl puts before "€" (see CLAUDE.md "Currency formatting"). */
const nbsp = (text: string | null) => (text ?? '').replace(/ /g, ' ');

function summary(overrides: Partial<OrderSummaryDto>): OrderSummaryDto {
  return {
    id: 'order-1',
    status: 'completed',
    totalAmount: 11000,
    createdAt: '2026-10-01T10:00:00.000Z',
    seatLabels: ['A1', 'A2'],
    event: { eventId: 'event-1', title: 'The Lighthouse Keeper' },
    performance: { performanceId: 'perf-1', date: '2026-10-16', time: '19:30:00', venue: 'Teatro Alameda', city: 'Madrid' },
    ...overrides,
  };
}

/** The order card for a given event title. */
function cardFor(title: string) {
  return screen.getByRole('heading', { name: title }).closest('article')!;
}

describe('MyTicketsScreen', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows a paid order with its date, venue, seats, total, and a link to it', async () => {
    vi.mocked(orderApi.listMyOrders).mockResolvedValue([summary({})]);
    renderWithProviders(<MyTicketsScreen />);

    await screen.findByRole('heading', { name: 'The Lighthouse Keeper' });
    const card = cardFor('The Lighthouse Keeper');
    expect(within(card).getByText('Paid')).toBeInTheDocument();
    expect(card.textContent).toContain('Fri 16 October 2026, 19:30 · Teatro Alameda, Madrid');
    expect(card.textContent).toContain('Seats A1, A2');
    expect(nbsp(card.textContent)).toContain('110,00 €');
    expect(within(card).getByRole('link', { name: 'View order' })).toHaveAttribute('href', '/order/order-1');
  });

  it('offers to finish payment on an order still awaiting it', async () => {
    vi.mocked(orderApi.listMyOrders).mockResolvedValue([summary({ id: 'order-2', status: 'payment_processing', seatLabels: ['B3'] })]);
    renderWithProviders(<MyTicketsScreen />);

    await screen.findByRole('heading', { name: 'The Lighthouse Keeper' });
    const card = cardFor('The Lighthouse Keeper');
    expect(within(card).getByText('Payment in progress')).toBeInTheDocument();
    expect(card.textContent).toContain('Seat B3');
    expect(within(card).getByRole('link', { name: 'Finish payment' })).toHaveAttribute('href', '/order/order-2');
  });

  it('lists an expired order after active ones, without seats or actions', async () => {
    vi.mocked(orderApi.listMyOrders).mockResolvedValue([
      summary({ id: 'order-new', status: 'cancelled', event: { eventId: 'event-2', title: 'Saltwater' } }),
      summary({ id: 'order-old', status: 'completed' }),
    ]);
    renderWithProviders(<MyTicketsScreen />);

    await screen.findByRole('heading', { name: 'Saltwater' });
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(['The Lighthouse Keeper', 'Saltwater']);

    const expired = cardFor('Saltwater');
    expect(within(expired).getByText('Payment expired')).toBeInTheDocument();
    expect(expired.textContent).not.toContain('Seats');
    expect(within(expired).queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows an empty state that links to the events', async () => {
    vi.mocked(orderApi.listMyOrders).mockResolvedValue([]);
    renderWithProviders(<MyTicketsScreen />);

    expect(await screen.findByText('No tickets yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse events' })).toHaveAttribute('href', '/');
  });

  it('shows the error when the orders fail to load', async () => {
    vi.mocked(orderApi.listMyOrders).mockRejectedValue(new Error('Network down'));
    renderWithProviders(<MyTicketsScreen />);

    expect(await screen.findByText('Failed to load your orders: Network down')).toBeInTheDocument();
  });
});
