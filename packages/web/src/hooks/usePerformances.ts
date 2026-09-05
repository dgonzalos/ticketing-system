import { useQuery } from '@tanstack/react-query';
import { listPerformances } from '../services/eventApi';

/** Fetches every performance scheduled for `eventId`, for rendering the event's schedule. */
export function usePerformances(eventId: string | undefined) {
  return useQuery({
    queryKey: ['performances', eventId],
    queryFn: () => listPerformances(eventId!),
    enabled: Boolean(eventId),
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}
