import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OrderDto } from '@ticketing-system/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/test-utils';
import { PaymentSuccessScreen } from './PaymentSuccessScreen';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../hooks/useDevAuth', () => ({
  useDevAuth: () => ({ token: 'test-token', error: null, isLoading: false }),
}));

vi.mock('../../services/orderApi');
vi.mock('../../services/seatApi', () => ({ listSeats: vi.fn().mockResolvedValue([]) }));
import * as orderApi from '../../services/orderApi';

const order: OrderDto = {
  id: 'order-1',
  userId: 'dev-user',
  email: 'buyer@example.com',
  performanceId: 'perf-1',
  status: 'completed',
  totalAmount: 5000,
  items: [{ seatId: 'seat-1', price: 5000 }],
  createdAt: '2026-01-01T00:00:00.000Z',
  paymentRequired: true,
};

function renderPaymentSuccessScreen() {
  return renderWithProviders(<PaymentSuccessScreen />, {
    route: '/order/order-1/payment-success',
    path: '/order/:orderId/payment-success',
  });
}

describe('PaymentSuccessScreen', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the completed order once it loads', async () => {
    vi.mocked(orderApi.getOrder).mockResolvedValue(order);

    renderPaymentSuccessScreen();

    expect(await screen.findByText('✅ Payment Complete!')).toBeInTheDocument();
    expect(screen.getByText('order-1')).toBeInTheDocument();
    expect(screen.getByText('Status: completed')).toBeInTheDocument();
    expect(screen.getByText('Email: buyer@example.com')).toBeInTheDocument();
  });

  it('navigates home when "Back to Events" is clicked', async () => {
    vi.mocked(orderApi.getOrder).mockResolvedValue(order);

    renderPaymentSuccessScreen();
    await screen.findByText('✅ Payment Complete!');

    await userEvent.click(screen.getByRole('button', { name: 'Back to Events' }));

    expect(navigateMock).toHaveBeenCalledWith('/');
  });

  it(
    'shows a not-found message when the order fetch fails',
    async () => {
      // useOrder hardcodes retry: 2 with backoff, so a rejected fetch takes a
      // few seconds (two retries) to actually surface as an error.
      vi.mocked(orderApi.getOrder).mockRejectedValue(new Error('Order not found: order-1'));

      renderPaymentSuccessScreen();

      expect(await screen.findByText(/Order not found/, undefined, { timeout: 8000 })).toBeInTheDocument();
    },
    10000
  );
});
