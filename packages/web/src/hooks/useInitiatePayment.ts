import { useMutation, useQueryClient } from '@tanstack/react-query';
import { initiatePayment } from '../services/orderApi';

interface UseInitiatePaymentOptions {
  /** JWT for the current user, or null while it's still being obtained. */
  token: string | null;
}

/**
 * Starts (or resumes) a hosted Stripe Checkout session for an order. On
 * success, seeds `useOrder`'s query cache with the order's new
 * `payment_processing` status; the caller is responsible for the actual
 * redirect (`window.location.href = result.paymentUrl`), since this leaves
 * the SPA entirely.
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
