/**
 * A guest's seat picks for one performance, kept in `sessionStorage` so
 * they survive the round trip through login (by any route — the Checkout
 * button, the header's "Log in", or the browser's Back button) and a
 * reload. Picks are never reserved while the user is a guest (a hold
 * belongs to a user account), so this is only ever a list of seat ids to
 * try reserving once they sign in.
 *
 * Per-tab and per-performance on purpose: a pick is meaningless outside
 * the seat map it was made on. Every access is wrapped — storage can be
 * unavailable (private mode, blocked site data), and losing the picks then
 * is acceptable; crashing the seat map is not.
 */
const keyFor = (performanceId: string) => `ticketing-guest-picks:${performanceId}`;

export function loadGuestPicks(performanceId: string): string[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(keyFor(performanceId)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveGuestPicks(performanceId: string, seatIds: string[]): void {
  try {
    if (seatIds.length === 0) {
      sessionStorage.removeItem(keyFor(performanceId));
    } else {
      sessionStorage.setItem(keyFor(performanceId), JSON.stringify(seatIds));
    }
  } catch {
    // Storage unavailable — the picks just won't survive a login round trip.
  }
}

export function clearGuestPicks(performanceId: string): void {
  saveGuestPicks(performanceId, []);
}
