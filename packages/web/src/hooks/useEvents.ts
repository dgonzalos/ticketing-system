import { useQuery } from '@tanstack/react-query';
import { listEvents } from '../services/eventApi';

/** Fetches every event, for rendering the top-level events list. */
export function useEvents() {
  return useQuery({
    queryKey: ['events'],
    queryFn: listEvents,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}
