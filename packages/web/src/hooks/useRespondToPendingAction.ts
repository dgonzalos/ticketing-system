import { useMutation } from '@tanstack/react-query';
import type { AiAssistantRespondRequestDto } from '@ticketing-system/shared';
import { respondToPendingAction } from '../services/adminAssistantApi';

interface UseRespondToPendingActionOptions {
  /** JWT for the current admin, or null while it's still being obtained. */
  token: string | null;
}

/** Confirms or rejects the currently pending write action. No React Query cache involved — same reasoning as `useSendAssistantMessage`. */
export function useRespondToPendingAction({ token }: UseRespondToPendingActionOptions) {
  return useMutation({
    mutationFn: (input: AiAssistantRespondRequestDto) => {
      if (!token) throw new Error('Not authenticated yet');
      return respondToPendingAction(input, token);
    },
  });
}
