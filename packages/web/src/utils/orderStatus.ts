import type { OrderStatus } from '@ticketing-system/shared';
import type { BadgeTone } from '../components/ui';

/** Buyer-facing wording and badge tone for each order status, instead of the raw `payment_processing`. */
export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: BadgeTone }> = {
  completed: { label: 'Paid', tone: 'success' },
  pending: { label: 'Awaiting payment', tone: 'warning' },
  payment_processing: { label: 'Payment in progress', tone: 'warning' },
  // Only a Stripe checkout.session.expired webhook cancels an order, so to a buyer it's an expired payment.
  cancelled: { label: 'Payment expired', tone: 'neutral' },
};

/** Whether the order is still waiting on its buyer to pay — i.e. a "Finish payment" action makes sense. */
export function isAwaitingPayment(status: OrderStatus): boolean {
  return status === 'pending' || status === 'payment_processing';
}
