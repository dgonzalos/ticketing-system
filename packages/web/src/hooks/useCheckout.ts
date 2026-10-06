import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateOrderRequestDto } from '@ticketing-system/shared';
import { createOrder } from '../services/orderApi';
import { MY_ORDERS_QUERY_KEY } from './useMyOrders';

interface UseCheckoutOptions {
  /** JWT for the current user, or null while it's still being obtained. */
  token: string | null;
}

/**
 * Places an order for the current user. On success, seeds the new order
 * into `useOrder`'s query cache so the confirmation screen can render
 * immediately without an extra round trip, and marks My tickets stale so
 * the new order shows there straight away.
 */
export function useCheckout({ token }: UseCheckoutOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateOrderRequestDto) => {
      if (!token) throw new Error('Not authenticated yet');
      return createOrder(input, token);
    },
    onSuccess: (order) => {
      queryClient.setQueryData(['order', order.id], order);
      queryClient.invalidateQueries({ queryKey: MY_ORDERS_QUERY_KEY });
    },
  });
}
