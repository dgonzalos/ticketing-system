import type { CreateOrderRequestDto, OrderDto, PaymentSessionResponseDto } from '@ticketing-system/shared';
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

/** Starts the (placeholder) payment flow for a pending order. */
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

/** Completes the (placeholder) payment flow, transitioning the order to `completed`. */
export async function confirmPayment(orderId: string, token: string): Promise<OrderDto> {
  const response = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}/confirm-payment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to confirm payment'));
  }
  return response.json();
}
