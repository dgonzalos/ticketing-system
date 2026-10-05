import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { SeatMap } from '../../components/Seats';
import type { Seat } from '../../components/Seats/types';
import { BackLink, Button, Card, LoadingState, Skeleton } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { useSeatSelection } from '../../hooks/useSeatSelection';
import { formatCents } from '../../utils/currency';
import { clearGuestPicks, loadGuestPicks } from '../../utils/guestPicks';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import styles from './SeatSelectionScreen.module.css';

interface PendingSeatsState {
  pendingSeatIds?: string[];
}

function seatLabel(seat: Seat): string {
  return `${seat.row}${seat.number}`;
}

/** "A1", "A1 and A2", "A1, A2 and A3". */
function joinLabels(labels: string[]): string {
  return labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * Route container for `/events/:eventId/performances/:performanceId`: the
 * seat-selection flow for one performance.
 *
 * Public, and so is picking seats: a guest's picks live only in the browser
 * (`useSeatSelection`'s guest mode, remembered in sessionStorage by
 * utils/guestPicks) — nothing is reserved, because a hold belongs to a user
 * account. Auth starts at **Checkout**: a guest is sent to /login carrying
 * `{ pendingSeatIds }` as the return location's state, which
 * `useAuthRedirect` forwards back here. The picks are then reserved in one go;
 * if all succeed the user continues straight to checkout, otherwise they stay
 * here with the taken seats named and the rest held. Logging in any other way
 * (header, Back) still reserves the remembered picks, but stays on the map.
 */
export function SeatSelectionScreen() {
  useDocumentTitle('Choose seats');
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
    reserveSeats,
    restoreGuestPicks,
    clearSelection,
  } = useSeatSelection({ performanceId: performanceId!, token });
  // Picks that couldn't be reserved after login — already gone, or lost the race.
  const [takenAfterLogin, setTakenAfterLogin] = useState<string[]>([]);
  // True while a guest's picks are being reserved after login — the single-click
  // "was just taken" note is suppressed meanwhile, so the two messages never
  // contradict each other mid-flight.
  const [isReservingPicks, setIsReservingPicks] = useState(false);

  const goToCheckout = () => {
    if (!isAuthenticated) {
      // The `{ from }` shape useAuthRedirect forwards back here after login/signup.
      navigate('/login', {
        state: {
          from: { pathname: location.pathname, search: location.search, state: { pendingSeatIds: selectedSeatIds } },
        },
      });
      return;
    }
    navigate('/checkout', { state: { performanceId, eventId, seatIds: selectedSeatIds } });
  };

  const handleSeatSelect = (seat: Seat) => {
    setTakenAfterLogin([]);
    onSeatSelect(seat);
  };

  // A guest coming back to this map (reload, Back from the login page): put
  // their remembered picks back, minus any that have gone meanwhile. Once.
  const guestPicksRestored = useRef(false);
  useEffect(() => {
    if (isAuthLoading || isAuthenticated || isSeatsLoading || guestPicksRestored.current) {
      return;
    }
    guestPicksRestored.current = true;
    const stillAvailable = loadGuestPicks(performanceId!).filter(
      (id) => seats.find((seat) => seat.id === id)?.status === 'available'
    );
    if (stillAvailable.length > 0) {
      restoreGuestPicks(stillAvailable);
    }
  }, [isAuthLoading, isAuthenticated, isSeatsLoading, seats, performanceId, restoreGuestPicks]);

  // Signed in with a guest's picks to reserve — reserve them, once. They
  // arrive either via the Checkout button (location state; then continue
  // straight to checkout, as that's where the user was heading) or from
  // storage after logging in some other way, e.g. the header's "Log in"
  // (then stay here — the user hasn't asked to buy yet). The ref is set
  // before anything async so StrictMode's double-invoked effect can't
  // reserve twice (seats are usually already cached here — the guest just
  // viewed this map — so both invocations would otherwise see loaded seats).
  // Clearing the location state and the stored picks stops a reload from
  // re-running it.
  const checkoutPicks = (location.state as PendingSeatsState | null)?.pendingSeatIds;
  const pendingHandled = useRef(false);
  useEffect(() => {
    if (!token || isSeatsLoading || pendingHandled.current) {
      return;
    }
    const continueToCheckout = Boolean(checkoutPicks?.length);
    const pendingSeatIds = continueToCheckout ? checkoutPicks! : loadGuestPicks(performanceId!);
    if (pendingSeatIds.length === 0) {
      return;
    }
    pendingHandled.current = true;
    clearGuestPicks(performanceId!);
    if (continueToCheckout) {
      navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
    }

    const stillAvailable = pendingSeatIds.filter((id) => seats.find((seat) => seat.id === id)?.status === 'available');
    const alreadyGone = pendingSeatIds.filter((id) => !stillAvailable.includes(id));

    setIsReservingPicks(true);
    void reserveSeats(stillAvailable).then(({ reserved, taken }) => {
      setIsReservingPicks(false);
      const notHeld = [...alreadyGone, ...taken];
      if (continueToCheckout && notHeld.length === 0 && reserved.length > 0) {
        navigate('/checkout', { state: { performanceId, eventId, seatIds: reserved } });
      } else {
        setTakenAfterLogin(notHeld);
      }
    });
  }, [checkoutPicks, token, isSeatsLoading, seats, reserveSeats, navigate, location.pathname, location.search, performanceId, eventId]);

  const labelsOf = (ids: string[]) =>
    ids.map((id) => seats.find((seat) => seat.id === id)).filter((seat): seat is Seat => Boolean(seat)).map(seatLabel);
  const takenAfterLoginLabels = labelsOf(takenAfterLogin);
  const takenSeat =
    takenAfterLogin.length === 0 && !isReservingPicks ? seats.find((seat) => seat.id === takenSeatId) : undefined;

  if (isSeatsLoading) {
    return (
      <div className={styles.screen}>
        <LoadingState>
          <div className={styles.layout}>
            <Skeleton height="32rem" radius="card" />
            <Skeleton height="12rem" radius="card" />
          </div>
        </LoadingState>
      </div>
    );
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
          <p>{selectedSeatIds.length} seat(s) selected</p>
          <p className={styles.total}>{formatCents(totalPrice)}</p>
          {takenAfterLoginLabels.length > 0 && (
            <p className={styles.error} role="status">
              {takenAfterLoginLabels.length === 1
                ? `Seat ${takenAfterLoginLabels[0]} was taken while you signed in`
                : `Seats ${joinLabels(takenAfterLoginLabels)} were taken while you signed in`}
              {selectedSeatIds.length > 0 ? ' — the rest are held for you.' : ' — please pick again.'}
            </p>
          )}
          {takenSeat && (
            <p className={styles.error} role="status">
              {`Seat ${seatLabel(takenSeat)} was just taken — please pick another.`}
            </p>
          )}
          {selectError && <p className={styles.error}>{(selectError as Error).message}</p>}
          <Button fullWidth disabled={selectedSeatIds.length === 0 || isAuthLoading} onClick={goToCheckout}>
            Checkout
          </Button>
          <Button fullWidth variant="secondary" disabled={selectedSeatIds.length === 0} onClick={clearSelection}>
            Clear selection
          </Button>
          {!isAuthenticated && !isAuthLoading && (
            <p className={styles.guestNote}>You&rsquo;ll log in or create an account at checkout.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
