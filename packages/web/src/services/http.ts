export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return typeof body?.error === 'string' ? body.error : fallback;
  } catch {
    return fallback;
  }
}

/**
 * An `Error` that also carries the response's HTTP status code. Every other
 * API client throws a plain `Error` — none of them have needed to tell one
 * failure apart from another at the UI layer. `adminAssistantApi.ts` is the
 * first that does (a 429 needs a dedicated "budget reached" state, distinct
 * from a generic error banner), so this is scoped to that client alone
 * rather than retrofitted onto the others.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
