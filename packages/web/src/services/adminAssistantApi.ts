import type {
  AiAssistantMessageRequestDto,
  AiAssistantRespondRequestDto,
  AiAssistantTurnResponseDto,
} from '@ticketing-system/shared';
import { API_BASE, ApiError, parseErrorMessage } from './http';

/** Sends one admin chat message, proposing a write action or getting a plain reply back. */
export async function sendAssistantMessage(
  input: AiAssistantMessageRequestDto,
  token: string
): Promise<AiAssistantTurnResponseDto> {
  const response = await fetch(`${API_BASE}/admin/assistant/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new ApiError(await parseErrorMessage(response, 'Failed to send message'), response.status);
  }
  return response.json();
}

/** Confirms or rejects the conversation's currently pending write action. */
export async function respondToPendingAction(
  input: AiAssistantRespondRequestDto,
  token: string
): Promise<AiAssistantTurnResponseDto> {
  const response = await fetch(`${API_BASE}/admin/assistant/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new ApiError(await parseErrorMessage(response, 'Failed to respond'), response.status);
  }
  return response.json();
}
