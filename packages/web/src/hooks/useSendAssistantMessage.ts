import { useMutation } from '@tanstack/react-query';
import type { AiAssistantMessageRequestDto } from '@ticketing-system/shared';
import { sendAssistantMessage } from '../services/adminAssistantApi';

interface UseSendAssistantMessageOptions {
  /** JWT for the current admin, or null while it's still being obtained. */
  token: string | null;
}

/** Sends one admin chat message. No React Query cache involved — the conversation lives in the screen's own local state, not a cached query. */
export function useSendAssistantMessage({ token }: UseSendAssistantMessageOptions) {
  return useMutation({
    mutationFn: (input: AiAssistantMessageRequestDto) => {
      if (!token) throw new Error('Not authenticated yet');
      return sendAssistantMessage(input, token);
    },
  });
}
