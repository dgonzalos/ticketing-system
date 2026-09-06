import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OrderDto } from '@ticketing-system/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/test-utils';
import { OrderConfirmationScreen } from './OrderConfirmationScreen';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ token: 'test-token', user: null, isAuthenticated: true, isLoading: false, error: null }),
}));

vi.mock('../../services/orderApi');
vi.mock('../../services/seatApi', () => ({ listSeats: vi.fn().mockResolvedValue([]) }));
import * as orderApi from '../../services/orderApi';

const order: OrderDto = {
  id: 'order-1',
  userId: 'dev-user',
  email: 'buyer@example.com',
  performanceId: 'perf-1',
  status: 'pending',
  totalAmount: 5000,
  items: [{ seatId: 'seat-1', price: 5000 }],
  createdAt: '2026-01-01T00:00:00.000Z',
  paymentRequired: true,
};

function renderOrderConfirmationScreen() {
  return renderWithProviders(<OrderConfirmationScreen />, {
    route: '/order/order-1',
    path: '/order/:orderId',
  });
}

describe('OrderConfirmationScreen', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls initiatePayment and navigates to the returned paymentUrl on click', async () => {
    vi.mocked(orderApi.getOrder).mockResolvedValue(order);
    vi.mocked(orderApi.initiatePayment).mockResolvedValue({
      paymentUrl: '/order/order-1/payment',
      orderId: 'order-1',
      status: 'payment_processing',
    });

    renderOrderConfirmationScreen();
    await screen.findByText('Continue to Payment');

    await userEvent.click(screen.getByRole('button', { name: 'Continue to Payment' }));

    await waitFor(() => {
      expect(orderApi.initiatePayment).toHaveBeenCalledWith('order-1', 'test-token');
      expect(navigateMock).toHaveBeenCalledWith('/order/order-1/payment');
    });
  });

  it('shows an error and re-enables the button when initiatePayment fails', async () => {
    vi.mocked(orderApi.getOrder).mockResolvedValue(order);
    vi.mocked(orderApi.initiatePayment).mockRejectedValue(new Error('Order is not in pending status'));

    renderOrderConfirmationScreen();
    await screen.findByText('Continue to Payment');

    await userEvent.click(screen.getByRole('button', { name: 'Continue to Payment' }));

    expect(await screen.findByText('Order is not in pending status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to Payment' })).not.toBeDisabled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('offers to resume payment instead of Continue to Payment when already payment_processing', async () => {
    vi.mocked(orderApi.getOrder).mockResolvedValue({ ...order, status: 'payment_processing' });

    renderOrderConfirmationScreen();
    await screen.findByText('Resume Payment');

    expect(screen.queryByRole('button', { name: 'Continue to Payment' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Resume Payment' }));

    expect(navigateMock).toHaveBeenCalledWith('/order/order-1/payment');
    expect(orderApi.initiatePayment).not.toHaveBeenCalled();
  });

  it('offers to view the payment confirmation instead of Continue to Payment when already completed', async () => {
    vi.mocked(orderApi.getOrder).mockResolvedValue({ ...order, status: 'completed' });

    renderOrderConfirmationScreen();
    await screen.findByText('View Payment Confirmation');

    expect(screen.queryByRole('button', { name: 'Continue to Payment' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'View Payment Confirmation' }));

    expect(navigateMock).toHaveBeenCalledWith('/order/order-1/payment-success');
    expect(orderApi.initiatePayment).not.toHaveBeenCalled();
  });
});
