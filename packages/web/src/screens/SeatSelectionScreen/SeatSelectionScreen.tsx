import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { SeatMap } from '../../components/Seats';
import type { Seat } from '../../components/Seats/types';
import { BackLink, Button, Card } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { useSeatSelection } from '../../hooks/useSeatSelection';
import { formatCents } from '../../utils/currency';
import styles from './SeatSelectionScreen.module.css';

interface PendingSeatState {
  pendingSeatId?: string;
}

/**
 * Route container for `/events/:eventId/performances/:performanceId`: the
 * seat-selection flow for one performance.
 *
 * Public: guests see the seat map and prices (`GET /seats` needs no token).
 * Auth starts at *choosing* a seat — a guest's seat click redirects to /login
 * carrying `{ pendingSeatId }` as the return location's state, which
 * `useAuthRedirect` forwards back here after login/signup, where the pending
 * seat is selected once on their behalf.
 */
export function SeatSelectionScreen() {
  const { eventId, performanceId } = useParams<{ eventId: string; performanceId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { token, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const {
    seats,
    selectedSeatIds,
    totalPrice,
    isSeatsLoading,
    seatsError,
    selectError,
    takenSeatId,
    onSeatSelect,
    clearSelection,
  } = useSeatSelection({ performanceId: performanceId!, token });
  // A pending seat (see below) that was already gone when the user came back from login/signup.
  const [unavailablePendingSeatId, setUnavailablePendingSeatId] = useState<string | null>(null);

  const goToCheckout = () =>
    navigate('/checkout', { state: { performanceId, eventId, seatIds: selectedSeatIds } });

  /** Sends a guest to /login, returning here afterwards (the `{ from }` shape `useAuthRedirect` forwards). */
  const goToLogin = useCallback(
    (pendingSeatId?: string) =>
      navigate('/login', {
        state: {
          from: {
            pathname: location.pathname,
            search: location.search,
            state: pendingSeatId ? { pendingSeatId } : undefined,
          },
        },
      }),
    [navigate, location.pathname, location.search]
  );

  // Must gate here, before onSeatSelect: useSeatSelection's mutations throw without a token.
  const handleSeatSelect = (seat: Seat) => {
    if (isAuthLoading) {
      return;
    }
    if (!isAuthenticated) {
      goToLogin(seat.id);
      return;
    }
    setUnavailablePendingSeatId(null);
    onSeatSelect(seat);
  };

  // After returning from login/signup, select the seat the guest originally
  // clicked — once. The ref guards against StrictMode's double-invoked effect;
  // clearing the location state stops a reload from re-triggering it.
  const pendingSeatId = (location.state as PendingSeatState | null)?.pendingSeatId;
  const pendingHandled = useRef(false);
  useEffect(() => {
    if (!pendingSeatId || !token || isSeatsLoading || pendingHandled.current) {
      return;
    }
    pendingHandled.current = true;
    const seat = seats.find((candidate) => candidate.id === pendingSeatId);
    // Already gone → don't try; say so. (If the cached list is stale and the
    // select loses the race instead, useSeatSelection's takenSeatId covers it.)
    if (seat?.status === 'available') {
      onSeatSelect(seat);
    } else if (seat) {
      setUnavailablePendingSeatId(seat.id);
    }
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
  }, [pendingSeatId, token, isSeatsLoading, seats, onSeatSelect, navigate, location.pathname, location.search]);

  const isGuest = !isAuthenticated && !isAuthLoading;
  const takenSeat = seats.find((seat) => seat.id === (takenSeatId ?? unavailablePendingSeatId));

  if (isSeatsLoading) {
    return <p className={styles.loading}>Loading seats…</p>;
  }

  if (seatsError) {
    return <p className={styles.error}>Failed to load seats: {(seatsError as Error).message}</p>;
  }

  return (
    <div className={styles.screen}>
      <BackLink to={`/events/${eventId}`}>Back to performances</BackLink>
      <ul className={styles.legend}>
        <li>
          <span className={clsx(styles.legendSwatch, styles.legendAvailable)} aria-hidden="true" /> Available
        </li>
        <li>
          <span className={clsx(styles.legendSwatch, styles.legendSelected)} aria-hidden="true" /> Your selection
        </li>
        <li>
          <span className={clsx(styles.legendSwatch, styles.legendReserved)} aria-hidden="true" /> Reserved
        </li>
        <li>
          <span className={clsx(styles.legendSwatch, styles.legendSold)} aria-hidden="true" /> Sold
        </li>
        <li>
          <span className={clsx(styles.legendSwatch, styles.legendBlocked)} aria-hidden="true" /> Unavailable
        </li>
      </ul>
      <div className={styles.layout}>
        <SeatMap seats={seats} selectedSeatIds={selectedSeatIds} onSeatSelect={handleSeatSelect} />

        <Card as="aside" className={styles.summary}>
          <h2>Your selection</h2>
          {isGuest ? (
            <>
              <p className={styles.guestNote}>Log in or create an account to choose seats.</p>
              <Button fullWidth onClick={() => goToLogin()}>
                Log in to choose seats
              </Button>
            </>
          ) : (
            <>
              <p>{selectedSeatIds.length} seat(s) selected</p>
              <p className={styles.total}>{formatCents(totalPrice)}</p>
              {takenSeat && (
                <p className={styles.error} role="status">
                  {`Seat ${takenSeat.row}${takenSeat.number} was just taken — please pick another.`}
                </p>
              )}
              {selectError && <p className={styles.error}>{(selectError as Error).message}</p>}
              <Button fullWidth disabled={selectedSeatIds.length === 0} onClick={goToCheckout}>
                Checkout
              </Button>
              <Button
                fullWidth
                variant="secondary"
                disabled={selectedSeatIds.length === 0}
                onClick={clearSelection}
              >
                Clear selection
              </Button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
