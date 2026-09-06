import { useMutation, useQueryClient } from '@tanstack/react-query';
import { initiatePayment } from '../services/orderApi';

interface UseInitiatePaymentOptions {
  /** JWT for the current user, or null while it's still being obtained. */
  token: string | null;
}

/**
 * Starts the (placeholder) payment flow for a pending order. On success,
 * seeds `useOrder`'s query cache with the order's new `payment_processing`
 * status so `PaymentScreen` doesn't need an extra round trip to see it.
 */
export function useInitiatePayment({ token }: UseInitiatePaymentOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (orderId: string) => {
      if (!token) throw new Error('Not authenticated yet');
      return initiatePayment(orderId, token);
    },
    onSuccess: (result, orderId) => {
      queryClient.setQueryData(['order', orderId], (previous: unknown) =>
        previous && typeof previous === 'object' ? { ...previous, status: result.status } : previous
      );
    },
  });
}
