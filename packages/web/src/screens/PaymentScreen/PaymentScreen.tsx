import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BackLink, Button } from '../../components/ui';
import { useConfirmPayment } from '../../hooks/useConfirmPayment';
import { useDevAuth } from '../../hooks/useDevAuth';
import { useOrder } from '../../hooks/useOrder';
import styles from './PaymentScreen.module.css';

// Placeholder until real login exists — matches SeatSelectionScreen.
const DEV_USER_ID = 'dev-user';

/** How long to show the simulated "processing" state before confirming. */
const PROCESSING_DELAY_MS = 2500;

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Route container for `/order/:orderId/payment`: the (placeholder) payment
 * processing step between initiating payment and its confirmation. Shows a
 * brief simulated "processing" delay, then confirms the payment and moves
 * on — no real payment provider is involved, this is scaffolding for a
 * Phase 2 Stripe/PayPal integration.
 */
export function PaymentScreen() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { token, error: authError } = useDevAuth(DEV_USER_ID);
  const { data: order, isLoading: isOrderLoading, error: orderError } = useOrder(orderId, { token });
  const confirmPayment = useConfirmPayment({ token });

  const confirm = () => {
    if (!orderId) {
      return;
    }
    confirmPayment.mutate(orderId, {
      onSuccess: () => navigate(`/order/${orderId}/payment-success`, { replace: true }),
    });
  };

  useEffect(() => {
    if (!orderId || !token) {
      return;
    }
    // No "already started" ref guard: React 18 StrictMode intentionally
    // mounts -> runs this effect -> cleans it up -> runs it again in dev, to
    // verify effects are idempotent. A ref-based guard would survive that
    // cleanup and block the second (real) run, so the timer would never
    // actually fire in dev. Cleanup + a fresh setTimeout on every real
    // mount is the correct, StrictMode-safe pattern here.
    const timer = setTimeout(confirm, PROCESSING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [orderId, token]);

  if (authError) {
    return <p className={styles.error}>Failed to authenticate: {authError.message}</p>;
  }

  if (isOrderLoading || !token) {
    return <p className={styles.loading}>Loading order…</p>;
  }

  if (orderError || !order) {
    return <p className={styles.error}>Order not found{orderError ? `: ${(orderError as Error).message}` : ''}</p>;
  }

  if (confirmPayment.error) {
    return (
      <div className={styles.screen}>
        <p className={styles.error}>{(confirmPayment.error as Error).message}</p>
        <Button fullWidth onClick={confirm}>
          Retry
        </Button>
        <BackLink to={`/order/${orderId}`}>Back to Order</BackLink>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <h1 className={styles.heading}>Processing Payment…</h1>
      <p className={styles.meta}>
        Order ID: <span className={styles.orderId}>{order.id}</span>
      </p>
      <p className={styles.meta}>Amount: {formatCents(order.totalAmount)}</p>
    </div>
  );
}
