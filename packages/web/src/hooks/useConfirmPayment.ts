import { useMutation, useQueryClient } from '@tanstack/react-query';
import { confirmPayment } from '../services/orderApi';

interface UseConfirmPaymentOptions {
  /** JWT for the current user, or null while it's still being obtained. */
  token: string | null;
}

/**
 * Completes the (placeholder) payment flow, transitioning the order to
 * `completed`. On success, seeds `useOrder`'s query cache with the completed
 * order so `PaymentSuccessScreen` doesn't need an extra round trip.
 */
export function useConfirmPayment({ token }: UseConfirmPaymentOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (orderId: string) => {
      if (!token) throw new Error('Not authenticated yet');
      return confirmPayment(orderId, token);
    },
    onSuccess: (order) => {
      queryClient.setQueryData(['order', order.id], order);
    },
  });
}
