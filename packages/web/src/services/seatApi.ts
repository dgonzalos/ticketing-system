import type { SeatDetailsDto } from '@ticketing-system/shared';
import type { Seat } from '../components/Seats/types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function toSeat(dto: SeatDetailsDto): Seat {
  const { seatId, ...rest } = dto;
  return { id: seatId, ...rest };
}

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return typeof body?.error === 'string' ? body.error : fallback;
  } catch {
    return fallback;
  }
}

/** Lists every seat belonging to a performance. Public — no auth required. */
export async function listSeats(performanceId: string): Promise<Seat[]> {
  const response = await fetch(`${API_BASE}/seats?performanceId=${encodeURIComponent(performanceId)}`);
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to fetch seats'));
  }
  const data: SeatDetailsDto[] = await response.json();
  return data.map(toSeat);
}

export interface SelectSeatResult {
  success: boolean;
  expiresAt: string;
  seatId: string;
}

/** Reserves a seat for 5 minutes on behalf of the authenticated user. */
export async function selectSeat(seatId: string, token: string): Promise<SelectSeatResult> {
  const response = await fetch(`${API_BASE}/seats/${encodeURIComponent(seatId)}/select`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 409) {
    throw new Error(await parseErrorMessage(response, 'Failed to select seat'));
  }
  return response.json();
}

/** Releases the authenticated user's reservation on a seat. */
export async function unlockSeat(seatId: string, token: string): Promise<void> {
  const response = await fetch(`${API_BASE}/seats/${encodeURIComponent(seatId)}/select`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to unlock seat'));
  }
}

/** Converts the authenticated user's reservation into a sale. */
export async function confirmSeat(seatId: string, token: string): Promise<void> {
  const response = await fetch(`${API_BASE}/seats/${encodeURIComponent(seatId)}/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to confirm seat'));
  }
}

/** Reports whether each requested seat is currently available to lock. Public — no auth required. */
export async function checkAvailability(seatIds: string[]): Promise<Record<string, boolean>> {
  const response = await fetch(`${API_BASE}/seats/check-availability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seatIds }),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to check availability'));
  }
  return response.json();
}

/** Exchanges a userId for a JWT via the backend's dev-only token route. Not real auth — see `api/routes/auth.ts`. */
export async function fetchDevToken(userId: string): Promise<string> {
  const response = await fetch(`${API_BASE}/auth/dev-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to obtain a dev token'));
  }
  const { token } = await response.json();
  return token;
}
