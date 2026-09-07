import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OrderDto } from '@ticketing-system/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/test-utils';
import { formatCents } from '../../utils/currency';
import { PaymentScreen } from './PaymentScreen';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ token: 'test-token', user: null, isAuthenticated: true, isLoading: false, error: null }),
}));

vi.mock('../../services/orderApi');
import * as orderApi from '../../services/orderApi';

const order: OrderDto = {
  id: 'order-1',
  userId: 'dev-user',
  email: 'buyer@example.com',
  performanceId: 'perf-1',
  status: 'payment_processing',
  totalAmount: 5000,
  items: [{ seatId: 'seat-1', price: 5000 }],
  createdAt: '2026-01-01T00:00:00.000Z',
  paymentRequired: true,
};

function renderPaymentScreen() {
  return renderWithProviders(<PaymentScreen />, {
    route: '/order/order-1/payment',
    path: '/order/:orderId/payment',
  });
}

describe('PaymentScreen', () => {
  beforeEach(() => {
    vi.mocked(orderApi.getOrder).mockResolvedValue(order);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders "Processing Payment…" with the order id and amount on mount', async () => {
    renderPaymentScreen();

    expect(await screen.findByText('Processing Payment…')).toBeInTheDocument();
    expect(screen.getByText('order-1')).toBeInTheDocument();
    // getByText's default normalizer collapses the NBSP formatCents() emits
    // before the euro sign into a plain   space, so match that form.
    const expectedAmount = `Amount: ${formatCents(5000).replace(/ /, ' ')}`;
    expect(screen.getByText(expectedAmount)).toBeInTheDocument();
  });

  it('confirms payment after the delay and navigates to the success screen', async () => {
    vi.mocked(orderApi.confirmPayment).mockResolvedValue({ ...order, status: 'completed' });

    renderPaymentScreen();
    await screen.findByText('Processing Payment…');

    await waitFor(
      () => {
        expect(orderApi.confirmPayment).toHaveBeenCalledWith('order-1', 'test-token');
      },
      { timeout: 4000 }
    );
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/order/order-1/payment-success', { replace: true });
    });
  });

  it('shows an error with Retry and Back to Order when confirmation fails', async () => {
    vi.mocked(orderApi.confirmPayment).mockRejectedValue(new Error('Payment confirmation failed'));

    renderPaymentScreen();
    await screen.findByText('Processing Payment…');

    expect(await screen.findByText('Payment confirmation failed', undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Back to Order' })).toHaveAttribute('href', '/order/order-1');
  });

  it('re-invokes confirmPayment when Retry is clicked', async () => {
    vi.mocked(orderApi.confirmPayment).mockRejectedValueOnce(new Error('Payment confirmation failed'));

    renderPaymentScreen();
    await screen.findByText('Processing Payment…');
    await screen.findByText('Payment confirmation failed', undefined, { timeout: 4000 });

    vi.mocked(orderApi.confirmPayment).mockResolvedValueOnce({ ...order, status: 'completed' });
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(orderApi.confirmPayment).toHaveBeenCalledTimes(2);
    });
  });
});
