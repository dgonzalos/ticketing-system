import { useQuery } from '@tanstack/react-query';
import { getPaymentStatus } from '../services/orderApi';

interface UsePaymentStatusOptions {
  /** JWT for the current user, or null while it's still being obtained. */
  token: string | null;
  /**
   * Poll every 2s while true. A Stripe webhook — not this client — is what
   * actually completes/cancels the order, so this is how the frontend
   * finds out once that's happened.
   */
  poll: boolean;
}

/** Reads an order's payment status, optionally polling while it's still pending. */
export function usePaymentStatus(orderId: string | undefined, { token, poll }: UsePaymentStatusOptions) {
  return useQuery({
    queryKey: ['paymentStatus', orderId],
    queryFn: () => getPaymentStatus(orderId!, token!),
    enabled: Boolean(orderId && token),
    refetchInterval: poll ? 2000 : false,
    retry: false,
  });
}
