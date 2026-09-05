import { useQuery } from '@tanstack/react-query';
import { listSeats } from '../services/seatApi';

/**
 * Fetches every seat belonging to a performance, for rendering a seat map or
 * a checkout/order summary. Shared by `useSeatSelection` and the checkout
 * screens so they hit the same query cache (`['seats', performanceId]`)
 * instead of each refetching independently.
 */
export function useSeats(performanceId: string | undefined) {
  return useQuery({
    queryKey: ['seats', performanceId],
    queryFn: () => listSeats(performanceId!),
    enabled: Boolean(performanceId && performanceId.length > 0),
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}
