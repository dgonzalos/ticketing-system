import { useQuery } from '@tanstack/react-query';
import { getOrder } from '../services/orderApi';

interface UseOrderOptions {
  /** JWT for the current user, or null while it's still being obtained. */
  token: string | null;
}

/** Fetches a single order, for the order confirmation screen. */
export function useOrder(orderId: string | undefined, { token }: UseOrderOptions) {
  return useQuery({
    queryKey: ['order', orderId],
    queryFn: () => getOrder(orderId!, token!),
    enabled: Boolean(orderId && token),
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}
