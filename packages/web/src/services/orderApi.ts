import type {
  CreateOrderRequestDto,
  OrderDto,
  PaymentSessionResponseDto,
  PaymentStatusResponseDto,
} from '@ticketing-system/shared';
import { API_BASE, parseErrorMessage } from './http';

/** Places an order for the authenticated user, atomically converting reserved seats into a sale. */
export async function createOrder(input: CreateOrderRequestDto, token: string): Promise<OrderDto> {
  const response = await fetch(`${API_BASE}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to place order'));
  }
  return response.json();
}

/** Reads a single order, for the order confirmation screen. */
export async function getOrder(orderId: string, token: string): Promise<OrderDto> {
  const response = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to fetch order'));
  }
  return response.json();
}

/**
 * Starts (or resumes) a hosted Stripe Checkout session for a pending — or
 * already `payment_processing` — order. `paymentUrl` is a real
 * `checkout.stripe.com` URL: redirect with `window.location.href`, not
 * client-side routing.
 */
export async function initiatePayment(orderId: string, token: string): Promise<PaymentSessionResponseDto> {
  const response = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}/payment-session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to start payment'));
  }
  return response.json();
}

/**
 * Reads an order's current payment status. A Stripe webhook — not the
 * client — is what actually completes/cancels the order, so the frontend
 * polls this while waiting for that to happen.
 */
export async function getPaymentStatus(orderId: string, token: string): Promise<PaymentStatusResponseDto> {
  const response = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}/payment-status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to fetch payment status'));
  }
  return response.json();
}
