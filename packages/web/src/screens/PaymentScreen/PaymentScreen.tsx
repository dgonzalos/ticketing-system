import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BackLink, Button } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { usePaymentStatus } from '../../hooks/usePaymentStatus';
import { formatCents } from '../../utils/currency';
import styles from './PaymentScreen.module.css';

/** ~60s of polling (`usePaymentStatus` polls every 2s) before giving up and offering a manual check instead. */
const MAX_POLL_ATTEMPTS = 30;

/**
 * Route container for `/order/:orderId/payment`: where Stripe's hosted
 * Checkout redirects back to after the buyer pays (or cancels). Completing
 * or cancelling the order is done by a Stripe webhook, not this page — it
 * only polls `GET /orders/:orderId/payment-status` until that's happened,
 * then moves on.
 */
export function PaymentScreen() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const [attempts, setAttempts] = useState(0);
  const timedOut = attempts >= MAX_POLL_ATTEMPTS;

  const { data, dataUpdatedAt, error } = usePaymentStatus(orderId, { token, poll: !timedOut });

  useEffect(() => {
    if (dataUpdatedAt) {
      setAttempts((n) => n + 1);
    }
  }, [dataUpdatedAt]);

  useEffect(() => {
    if (!orderId || !data) {
      return;
    }
    if (data.status === 'completed') {
      navigate(`/order/${orderId}/payment-success`, { replace: true });
    } else if (data.status === 'cancelled') {
      navigate(`/order/${orderId}`, { replace: true });
    }
  }, [data, orderId, navigate]);

  if (error) {
    return (
      <div className={styles.screen}>
        <p className={styles.error}>{(error as Error).message}</p>
        <BackLink to={`/order/${orderId}`}>Back to Order</BackLink>
      </div>
    );
  }

  if (timedOut) {
    return (
      <div className={styles.screen}>
        <h1 className={styles.heading}>Still processing…</h1>
        <p className={styles.meta}>This is taking longer than usual. You can check again, or come back to this page later.</p>
        <Button fullWidth onClick={() => setAttempts(0)}>
          Check again
        </Button>
        <BackLink to={`/order/${orderId}`}>Back to Order</BackLink>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <h1 className={styles.heading}>Processing Payment…</h1>
      <p className={styles.meta}>
        Order ID: <span className={styles.orderId}>{orderId}</span>
      </p>
      {data && <p className={styles.meta}>Amount: {formatCents(data.totalAmount)}</p>}
    </div>
  );
}
