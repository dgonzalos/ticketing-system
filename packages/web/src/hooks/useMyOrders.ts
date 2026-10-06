import { useQuery } from '@tanstack/react-query';
import { listMyOrders } from '../services/orderApi';
import { useAuth } from './useAuth';

/** Prefix shared by every user's cached order list, so a checkout can invalidate it without knowing the user id. */
export const MY_ORDERS_QUERY_KEY = ['orders', 'mine'] as const;

/**
 * The signed-in user's orders, for the My tickets screen. Keyed by user id
 * so that after a logout and a login as someone else, the previous user's
 * cached orders can never be shown. A short `staleTime`, because an order's
 * status changes behind the scenes (the Stripe webhook completes it).
 */
export function useMyOrders() {
  const { token, user } = useAuth();
  return useQuery({
    queryKey: [...MY_ORDERS_QUERY_KEY, user?.id],
    queryFn: () => listMyOrders(token!),
    enabled: Boolean(token && user),
    staleTime: 30 * 1000,
  });
}
