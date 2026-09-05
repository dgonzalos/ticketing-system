export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return typeof body?.error === 'string' ? body.error : fallback;
  } catch {
    return fallback;
  }
}
