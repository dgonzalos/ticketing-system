import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PriceSummary, SeatsSummaryList } from '../../components/Orders';
import type { OrderSeatSummary } from '../../components/Orders';
import { BackLink, Button, Card, Input } from '../../components/ui';
import { useCheckout } from '../../hooks/useCheckout';
import { useDevAuth } from '../../hooks/useDevAuth';
import { usePerformances } from '../../hooks/usePerformances';
import { useSeats } from '../../hooks/useSeats';
import styles from './CheckoutScreen.module.css';

// Placeholder until real login exists — matches SeatSelectionScreen.
const DEV_USER_ID = 'dev-user';

/**
 * Sales tax applied on top of seat prices. Must match
 * `packages/api/src/infrastructure/db/drizzle-order.repository.ts`'s own
 * `TAX_RATE` constant, which recalculates and validates this total
 * server-side — see that file's doc comment for why this can't live in
 * `@ticketing-system/shared` instead.
 */
const TAX_RATE = 0.1;

interface CheckoutLocationState {
  performanceId: string;
  eventId: string;
  seatIds: string[];
}

function isCheckoutLocationState(state: unknown): state is CheckoutLocationState {
  return (
    typeof state === 'object' &&
    state !== null &&
    typeof (state as CheckoutLocationState).performanceId === 'string' &&
    typeof (state as CheckoutLocationState).eventId === 'string' &&
    Array.isArray((state as CheckoutLocationState).seatIds)
  );
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Route container for `/checkout`: captures the buyer's email and places
 * the order for the seats selected on the previous screen. Reached only via
 * `SeatSelectionScreen`'s "Checkout" button, which passes
 * `{ performanceId, eventId, seatIds }` as router location state — there is
 * no query-param/URL form of this data, so a direct visit or a page refresh
 * has nothing to check out against and is redirected back to `/`.
 */
export function CheckoutScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = isCheckoutLocationState(location.state) ? location.state : null;

  const { token, error: authError } = useDevAuth(DEV_USER_ID);
  const { data: performances = [] } = usePerformances(state?.eventId);
  const { data: seats = [], isLoading: isSeatsLoading, error: seatsError } = useSeats(state?.performanceId);
  const checkout = useCheckout({ token });

  const [email, setEmail] = useState('');
  const [touchedEmail, setTouchedEmail] = useState(false);

  useEffect(() => {
    if (!state) {
      navigate('/', { replace: true });
    }
  }, [state, navigate]);

  const performance = performances.find((p) => p.id === state?.performanceId);

  const selectedSeats = useMemo(
    () => (state ? seats.filter((seat) => state.seatIds.includes(seat.id)) : []),
    [seats, state]
  );
  const seatSummaries: OrderSeatSummary[] = selectedSeats.map((seat) => ({
    seatId: seat.id,
    row: seat.row,
    number: seat.number,
    zone: seat.zone,
    price: seat.price,
  }));

  const subtotal = selectedSeats.reduce((sum, seat) => sum + seat.price, 0);
  const tax = Math.round(subtotal * TAX_RATE);
  const total = subtotal + tax;

  if (!state) {
    return null;
  }

  if (authError) {
    return <p className={styles.error}>Failed to authenticate: {authError.message}</p>;
  }

  if (isSeatsLoading || !token) {
    return <p className={styles.loading}>Loading checkout…</p>;
  }

  if (seatsError) {
    return <p className={styles.error}>Failed to load seats: {(seatsError as Error).message}</p>;
  }

  const emailError = touchedEmail && !isValidEmail(email) ? 'Enter a valid email address' : undefined;
  const seatsStillReserved = selectedSeats.length === state.seatIds.length && selectedSeats.every((seat) => seat.status === 'reserved');
  const canSubmit = isValidEmail(email) && seatsStillReserved && !checkout.isPending;

  const handleSubmit = () => {
    setTouchedEmail(true);
    if (!canSubmit) {
      return;
    }
    checkout.mutate(
      { performanceId: state.performanceId, seatIds: state.seatIds, totalAmount: total, email },
      { onSuccess: (order) => navigate(`/order/${order.id}`, { replace: true }) }
    );
  };

  return (
    <div className={styles.screen}>
      <BackLink to={`/events/${state.eventId}/performances/${state.performanceId}`}>Back to seat selection</BackLink>
      <div className={styles.layout}>
        <Card as="section" className={styles.details}>
          {performance && (
            <>
              <h2>{performance.venue}</h2>
              <p className={styles.performanceMeta}>
                {performance.date} at {performance.time} — {performance.city}
              </p>
            </>
          )}
          <SeatsSummaryList seats={seatSummaries} />
        </Card>

        <Card as="aside" className={styles.summary}>
          <h2>Checkout</h2>
          <Input
            label="Email address"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouchedEmail(true)}
            error={emailError}
          />
          <PriceSummary subtotal={subtotal} tax={tax} total={total} />
          {!seatsStillReserved && (
            <p className={styles.error}>One or more seats are no longer reserved. Please select again.</p>
          )}
          {checkout.error && <p className={styles.error}>{(checkout.error as Error).message}</p>}
          <Button fullWidth disabled={!canSubmit} onClick={handleSubmit}>
            {checkout.isPending ? 'Confirming…' : 'Confirm Purchase'}
          </Button>
        </Card>
      </div>
    </div>
  );
}
