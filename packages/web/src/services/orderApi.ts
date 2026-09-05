import type { CreateOrderRequestDto, OrderDto } from '@ticketing-system/shared';
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
