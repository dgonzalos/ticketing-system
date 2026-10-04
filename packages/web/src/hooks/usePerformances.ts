import { useQuery } from '@tanstack/react-query';
import { listPerformances } from '../services/eventApi';

/**
 * Fetches `eventId`'s upcoming performances, for rendering the event's
 * schedule. A much shorter `staleTime` than `useEvents`: each row shows live
 * availability ("Only 4 seats left", "Sold out"), which goes stale far
 * faster than an event's "from" price.
 */
export function usePerformances(eventId: string | undefined) {
  return useQuery({
    queryKey: ['performances', eventId],
    queryFn: () => listPerformances(eventId!),
    enabled: Boolean(eventId),
    staleTime: 30 * 1000,
    retry: 2,
  });
}
