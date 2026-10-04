import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Seat } from '../../components/Seats/types';
import { SeatSelectionScreen } from './SeatSelectionScreen';

const authState = { token: null as string | null, isAuthenticated: false, isLoading: false };
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ ...authState, user: null, error: null }),
}));

vi.mock('../../services/seatApi');
import * as seatApi from '../../services/seatApi';

const SEAT_PATH = '/events/event-1/performances/perf-1';

const seats: Seat[] = [
  { id: 'perf-1-A1', performanceId: 'perf-1', row: 'A', number: 1, zone: 'premium', price: 15000, status: 'available', reservedUntil: null },
  { id: 'perf-1-A2', performanceId: 'perf-1', row: 'A', number: 2, zone: 'premium', price: 15000, status: 'sold', reservedUntil: null },
];

/** Stand-in for /login that exposes the location state it was navigated with. */
function LoginProbe() {
  const location = useLocation();
  return <pre data-testid="login-state">{JSON.stringify(location.state)}</pre>;
}

function renderSeatSelectionScreen(state?: unknown, { warmCache = false } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (warmCache) {
    // The real return-from-signup case: the guest just viewed this seat map,
    // so the seats query is already cached when the screen remounts.
    queryClient.setQueryData(['seats', 'perf-1'], seats);
  }
  // StrictMode, as in src/index.tsx: it double-invokes effects, which is
  // exactly what the pending-seat effect's useRef guard has to survive.
  return render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[{ pathname: SEAT_PATH, state }]}>
          <Routes>
            <Route path="/events/:eventId/performances/:performanceId" element={<SeatSelectionScreen />} />
            <Route path="/login" element={<LoginProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>
  );
}

describe('SeatSelectionScreen', () => {
  afterEach(() => {
    vi.clearAllMocks();
    Object.assign(authState, { token: null, isAuthenticated: false, isLoading: false });
  });

  it('shows a guest the seat map with prices, and a prompt to log in instead of checkout', async () => {
    vi.mocked(seatApi.listSeats).mockResolvedValue(seats);

    renderSeatSelectionScreen();

    expect(await screen.findByRole('button', { name: /^Seat A1, Available, 150,00/ })).toBeInTheDocument();
    expect(screen.getByText('Log in or create an account to choose seats.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Checkout' })).not.toBeInTheDocument();
  });

  it('sends a guest who clicks a seat to /login, carrying the seat as pendingSeatId', async () => {
    vi.mocked(seatApi.listSeats).mockResolvedValue(seats);

    renderSeatSelectionScreen();
    await userEvent.click(await screen.findByRole('button', { name: /^Seat A1/ }));

    const state = JSON.parse((await screen.findByTestId('login-state')).textContent ?? 'null');
    expect(state).toEqual({ from: { pathname: SEAT_PATH, search: '', state: { pendingSeatId: 'perf-1-A1' } } });
    expect(seatApi.selectSeat).not.toHaveBeenCalled();
  });

  it('selects the pending seat exactly once after a signed-in user returns', async () => {
    Object.assign(authState, { token: 'test-token', isAuthenticated: true });
    vi.mocked(seatApi.listSeats).mockResolvedValue(seats);
    vi.mocked(seatApi.selectSeat).mockResolvedValue({ success: true, expiresAt: '', seatId: 'perf-1-A1' });

    renderSeatSelectionScreen({ pendingSeatId: 'perf-1-A1' }, { warmCache: true });

    expect(await screen.findByText('1 seat(s) selected')).toBeInTheDocument();
    await waitFor(() => expect(seatApi.selectSeat).toHaveBeenCalledTimes(1));
    expect(seatApi.selectSeat).toHaveBeenCalledWith('perf-1-A1', 'test-token');
  });

  it('does not select a pending seat that is no longer available, and says so', async () => {
    Object.assign(authState, { token: 'test-token', isAuthenticated: true });
    vi.mocked(seatApi.listSeats).mockResolvedValue(seats);

    renderSeatSelectionScreen({ pendingSeatId: 'perf-1-A2' });

    expect(await screen.findByText('Seat A2 was just taken — please pick another.')).toBeInTheDocument();
    expect(screen.getByText('0 seat(s) selected')).toBeInTheDocument();
    expect(seatApi.selectSeat).not.toHaveBeenCalled();
  });

  it('tells the user when a pending seat loses the race despite looking available (stale cache)', async () => {
    Object.assign(authState, { token: 'test-token', isAuthenticated: true });
    vi.mocked(seatApi.listSeats).mockResolvedValue(seats);
    vi.mocked(seatApi.selectSeat).mockResolvedValue({ success: false, expiresAt: '', seatId: 'perf-1-A1' });

    renderSeatSelectionScreen({ pendingSeatId: 'perf-1-A1' });

    expect(await screen.findByText('Seat A1 was just taken — please pick another.')).toBeInTheDocument();
    expect(screen.getByText('0 seat(s) selected')).toBeInTheDocument();
  });

  it('tells a signed-in user when a seat they click is taken by someone else first', async () => {
    Object.assign(authState, { token: 'test-token', isAuthenticated: true });
    vi.mocked(seatApi.listSeats).mockResolvedValue(seats);
    vi.mocked(seatApi.selectSeat).mockResolvedValue({ success: false, expiresAt: '', seatId: 'perf-1-A1' });

    renderSeatSelectionScreen();
    await userEvent.click(await screen.findByRole('button', { name: /^Seat A1/ }));

    expect(await screen.findByText('Seat A1 was just taken — please pick another.')).toBeInTheDocument();
  });
});
