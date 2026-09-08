import { screen, waitFor } from '@testing-library/react';
import type { PaymentStatusResponseDto } from '@ticketing-system/shared';
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

const processingStatus: PaymentStatusResponseDto = { status: 'payment_processing', totalAmount: 5000 };

function renderPaymentScreen() {
  return renderWithProviders(<PaymentScreen />, {
    route: '/order/order-1/payment',
    path: '/order/:orderId/payment',
  });
}

describe('PaymentScreen', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders "Processing Payment…" with the order id and amount while still processing', async () => {
    vi.mocked(orderApi.getPaymentStatus).mockResolvedValue(processingStatus);

    renderPaymentScreen();

    expect(await screen.findByText('Processing Payment…')).toBeInTheDocument();
    expect(screen.getByText('order-1')).toBeInTheDocument();
    // getByText's default normalizer collapses the NBSP formatCents() emits
    // before the euro sign into a plain space, so match that form.
    const expectedAmount = `Amount: ${formatCents(5000).replace(/ /, ' ')}`;
    expect(await screen.findByText(expectedAmount)).toBeInTheDocument();
  });

  it('navigates to the success screen once the webhook marks the order completed', async () => {
    vi.mocked(orderApi.getPaymentStatus).mockResolvedValue({ status: 'completed', totalAmount: 5000 });

    renderPaymentScreen();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/order/order-1/payment-success', { replace: true });
    });
  });

  it('navigates back to the order when the webhook cancels it', async () => {
    vi.mocked(orderApi.getPaymentStatus).mockResolvedValue({ status: 'cancelled', totalAmount: 5000 });

    renderPaymentScreen();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/order/order-1', { replace: true });
    });
  });

  it('shows an error with a way back when the status check fails', async () => {
    vi.mocked(orderApi.getPaymentStatus).mockRejectedValue(new Error('Failed to fetch payment status'));

    renderPaymentScreen();

    expect(await screen.findByText('Failed to fetch payment status')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Back to Order' })).toHaveAttribute('href', '/order/order-1');
  });
});
