import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
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

const seat = (number: number, status: Seat['status']): Seat => ({
  id: `perf-1-A${number}`,
  performanceId: 'perf-1',
  row: 'A',
  number,
  zone: 'premium',
  price: 15000,
  status,
  reservedUntil: null,
});

const seats: Seat[] = [seat(1, 'available'), seat(2, 'sold'), seat(3, 'available')];

/** Stand-in for a route, exposing the location state it was navigated with. */
function StateProbe({ testId }: { testId: string }) {
  const location = useLocation();
  return <pre data-testid={testId}>{JSON.stringify(location.state)}</pre>;
}

const probedState = async (testId: string) => JSON.parse((await screen.findByTestId(testId)).textContent ?? 'null');

function signIn() {
  Object.assign(authState, { token: 'test-token', isAuthenticated: true });
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
  // exactly what the pending-seats effect's useRef guard has to survive.
  // A function, not one element: re-rendering the *same* element object lets
  // React bail out without re-rendering, so the screen would never re-read auth.
  const tree = () => (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[{ pathname: SEAT_PATH, state }]}>
          <Routes>
            <Route path="/events/:eventId/performances/:performanceId" element={<SeatSelectionScreen />} />
            <Route path="/login" element={<StateProbe testId="login-state" />} />
            <Route path="/checkout" element={<StateProbe testId="checkout-state" />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>
  );
  const result = render(tree());
  /** Re-renders the same mounted screen — e.g. after changing `authState`, as a logout would. */
  const rerenderSame = () => result.rerender(tree());
  return { ...result, rerenderSame };
}

describe('SeatSelectionScreen', () => {
  afterEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    Object.assign(authState, { token: null, isAuthenticated: false, isLoading: false });
  });

  describe('as a guest', () => {
    it('picks and unpicks seats locally, without reserving anything', async () => {
      vi.mocked(seatApi.listSeats).mockResolvedValue(seats);

      renderSeatSelectionScreen();
      const a1 = await screen.findByRole('button', { name: /^Seat A1/ });

      await userEvent.click(a1);
      expect(screen.getByText('1 seat(s) selected')).toBeInTheDocument();
      expect(within(screen.getByRole('complementary')).getByText(/^150,00/)).toBeInTheDocument();

      await userEvent.click(a1);
      expect(screen.getByText('0 seat(s) selected')).toBeInTheDocument();

      expect(seatApi.selectSeat).not.toHaveBeenCalled();
      expect(screen.getByText('You’ll log in or create an account at checkout.')).toBeInTheDocument();
    });

    it('clears its picks locally', async () => {
      vi.mocked(seatApi.listSeats).mockResolvedValue(seats);

      renderSeatSelectionScreen();
      await userEvent.click(await screen.findByRole('button', { name: /^Seat A1/ }));
      await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));

      expect(screen.getByText('0 seat(s) selected')).toBeInTheDocument();
      expect(seatApi.unlockSeat).not.toHaveBeenCalled();
    });

    it('is sent to /login at Checkout, carrying the picks', async () => {
      vi.mocked(seatApi.listSeats).mockResolvedValue(seats);

      renderSeatSelectionScreen();
      await userEvent.click(await screen.findByRole('button', { name: /^Seat A1/ }));
      await userEvent.click(screen.getByRole('button', { name: /^Seat A3/ }));
      await userEvent.click(screen.getByRole('button', { name: 'Checkout' }));

      expect(await probedState('login-state')).toEqual({
        from: { pathname: SEAT_PATH, search: '', state: { pendingSeatIds: ['perf-1-A1', 'perf-1-A3'] } },
      });
      expect(seatApi.selectSeat).not.toHaveBeenCalled();
    });

    it('keeps its picks across a reload, minus any that have gone meanwhile', async () => {
      vi.mocked(seatApi.listSeats).mockResolvedValue(seats);
      const first = renderSeatSelectionScreen();
      await userEvent.click(await screen.findByRole('button', { name: /^Seat A1/ }));
      await userEvent.click(screen.getByRole('button', { name: /^Seat A3/ }));
      first.unmount();

      // A1 was taken by someone else while the page was reloading.
      vi.mocked(seatApi.listSeats).mockResolvedValue([seat(1, 'reserved'), seat(2, 'sold'), seat(3, 'available')]);
      renderSeatSelectionScreen();

      expect(await screen.findByText('1 seat(s) selected')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Seat A3/ })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('signing in some other way with picks (header "Log in", Back)', () => {
    it('reserves the remembered picks but stays on the map', async () => {
      sessionStorage.setItem('ticketing-guest-picks:perf-1', JSON.stringify(['perf-1-A1', 'perf-1-A3']));
      signIn();
      vi.mocked(seatApi.listSeats).mockResolvedValue(seats);
      vi.mocked(seatApi.selectSeat).mockImplementation(async (seatId) => ({ success: true, expiresAt: '', seatId }));

      renderSeatSelectionScreen(undefined, { warmCache: true });

      expect(await screen.findByText('2 seat(s) selected')).toBeInTheDocument();
      expect(seatApi.selectSeat).toHaveBeenCalledTimes(2);
      expect(screen.queryByTestId('checkout-state')).not.toBeInTheDocument();
      expect(sessionStorage.getItem('ticketing-guest-picks:perf-1')).toBeNull();
    });
  });

  describe('returning from login with picks', () => {
    it('reserves each pick exactly once and continues straight to checkout', async () => {
      signIn();
      vi.mocked(seatApi.listSeats).mockResolvedValue(seats);
      vi.mocked(seatApi.selectSeat).mockImplementation(async (seatId) => ({ success: true, expiresAt: '', seatId }));

      renderSeatSelectionScreen({ pendingSeatIds: ['perf-1-A1', 'perf-1-A3'] }, { warmCache: true });

      expect(await probedState('checkout-state')).toEqual({
        performanceId: 'perf-1',
        eventId: 'event-1',
        seatIds: ['perf-1-A1', 'perf-1-A3'],
      });
      expect(seatApi.selectSeat).toHaveBeenCalledTimes(2);
      expect(seatApi.selectSeat).toHaveBeenCalledWith('perf-1-A1', 'test-token');
      expect(seatApi.selectSeat).toHaveBeenCalledWith('perf-1-A3', 'test-token');
    });

    it('stays and names a pick that lost the race, keeping the rest held', async () => {
      signIn();
      vi.mocked(seatApi.listSeats).mockResolvedValue(seats);
      vi.mocked(seatApi.selectSeat).mockImplementation(async (seatId) => ({
        success: seatId !== 'perf-1-A3',
        expiresAt: '',
        seatId,
      }));

      renderSeatSelectionScreen({ pendingSeatIds: ['perf-1-A1', 'perf-1-A3'] }, { warmCache: true });

      expect(
        await screen.findByText('Seat A3 was taken while you signed in — the rest are held for you.')
      ).toBeInTheDocument();
      expect(screen.getByText('1 seat(s) selected')).toBeInTheDocument();
      expect(screen.queryByTestId('checkout-state')).not.toBeInTheDocument();
    });

    it('does not try a pick that is already gone, and names it', async () => {
      signIn();
      vi.mocked(seatApi.listSeats).mockResolvedValue(seats);
      vi.mocked(seatApi.selectSeat).mockImplementation(async (seatId) => ({ success: true, expiresAt: '', seatId }));

      renderSeatSelectionScreen({ pendingSeatIds: ['perf-1-A1', 'perf-1-A2'] }, { warmCache: true });

      expect(
        await screen.findByText('Seat A2 was taken while you signed in — the rest are held for you.')
      ).toBeInTheDocument();
      expect(seatApi.selectSeat).toHaveBeenCalledTimes(1);
      expect(seatApi.selectSeat).toHaveBeenCalledWith('perf-1-A1', 'test-token');
    });

    it('never shows the single-click "just taken" note while the picks are still being reserved', async () => {
      signIn();
      vi.mocked(seatApi.listSeats).mockResolvedValue(seats);
      let releaseA1: () => void = () => {};
      vi.mocked(seatApi.selectSeat).mockImplementation((seatId) =>
        seatId === 'perf-1-A1'
          ? new Promise((resolve) => {
              releaseA1 = () => resolve({ success: true, expiresAt: '', seatId });
            })
          : Promise.resolve({ success: false, expiresAt: '', seatId })
      );

      renderSeatSelectionScreen({ pendingSeatIds: ['perf-1-A1', 'perf-1-A3'] }, { warmCache: true });

      // A3 has already lost its race; A1 is still in flight.
      await waitFor(() => expect(seatApi.selectSeat).toHaveBeenCalledTimes(2));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByText(/was just taken/)).not.toBeInTheDocument();

      releaseA1();
      expect(
        await screen.findByText('Seat A3 was taken while you signed in — the rest are held for you.')
      ).toBeInTheDocument();
      expect(screen.queryByText(/was just taken/)).not.toBeInTheDocument();
    });

    it('asks to pick again when every pick was taken', async () => {
      signIn();
      vi.mocked(seatApi.listSeats).mockResolvedValue(seats);
      vi.mocked(seatApi.selectSeat).mockImplementation(async (seatId) => ({ success: false, expiresAt: '', seatId }));

      renderSeatSelectionScreen({ pendingSeatIds: ['perf-1-A1', 'perf-1-A3'] }, { warmCache: true });

      expect(
        await screen.findByText('Seats A1 and A3 were taken while you signed in — please pick again.')
      ).toBeInTheDocument();
    });
  });

  describe('signed in', () => {
    it('reserves a seat on click, as before', async () => {
      signIn();
      vi.mocked(seatApi.listSeats).mockResolvedValue(seats);
      vi.mocked(seatApi.selectSeat).mockResolvedValue({ success: true, expiresAt: '', seatId: 'perf-1-A1' });

      renderSeatSelectionScreen();
      await userEvent.click(await screen.findByRole('button', { name: /^Seat A1/ }));

      await waitFor(() => expect(seatApi.selectSeat).toHaveBeenCalledWith('perf-1-A1', 'test-token'));
      expect(await screen.findByText('1 seat(s) selected')).toBeInTheDocument();
      expect(screen.queryByText(/at checkout/)).not.toBeInTheDocument();
    });

    it('says so when a clicked seat is taken by someone else first', async () => {
      signIn();
      vi.mocked(seatApi.listSeats).mockResolvedValue(seats);
      vi.mocked(seatApi.selectSeat).mockResolvedValue({ success: false, expiresAt: '', seatId: 'perf-1-A1' });

      renderSeatSelectionScreen();
      await userEvent.click(await screen.findByRole('button', { name: /^Seat A1/ }));

      expect(await screen.findByText('Seat A1 was just taken — please pick another.')).toBeInTheDocument();
    });

    it('drops its reserved seats from the selection on logout, rather than treating them as guest picks', async () => {
      signIn();
      vi.mocked(seatApi.listSeats).mockResolvedValue(seats);
      vi.mocked(seatApi.selectSeat).mockResolvedValue({ success: true, expiresAt: '', seatId: 'perf-1-A1' });

      const { rerenderSame } = renderSeatSelectionScreen();
      await userEvent.click(await screen.findByRole('button', { name: /^Seat A1/ }));
      expect(await screen.findByText('1 seat(s) selected')).toBeInTheDocument();

      // Log out while this same screen stays mounted.
      Object.assign(authState, { token: null, isAuthenticated: false });
      rerenderSame();

      expect(await screen.findByText('0 seat(s) selected')).toBeInTheDocument();
      expect(screen.getByText('You’ll log in or create an account at checkout.')).toBeInTheDocument();
    });

    it('goes to checkout with the selection', async () => {
      signIn();
      vi.mocked(seatApi.listSeats).mockResolvedValue(seats);
      vi.mocked(seatApi.selectSeat).mockResolvedValue({ success: true, expiresAt: '', seatId: 'perf-1-A1' });

      renderSeatSelectionScreen();
      await userEvent.click(await screen.findByRole('button', { name: /^Seat A1/ }));
      await screen.findByText('1 seat(s) selected');
      await userEvent.click(screen.getByRole('button', { name: 'Checkout' }));

      expect(await probedState('checkout-state')).toEqual({ performanceId: 'perf-1', eventId: 'event-1', seatIds: ['perf-1-A1'] });
    });
  });
});
