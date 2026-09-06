import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PriceSummary, SeatsSummaryList } from '../../components/Orders';
import type { OrderSeatSummary } from '../../components/Orders';
import { Button, Card } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { useInitiatePayment } from '../../hooks/useInitiatePayment';
import { useOrder } from '../../hooks/useOrder';
import { useSeats } from '../../hooks/useSeats';
import styles from './OrderConfirmationScreen.module.css';

/**
 * Route container for `/order/:orderId`: shows the order the buyer is
 * about to pay for. Deliberately framed as a summary, not a confirmation —
 * the order's status is `pending` at this point (payment hasn't happened
 * yet, see the "Continue to Payment" button below), so nothing here should
 * read as "confirmed".
 */
export function OrderConfirmationScreen() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const { data: order, isLoading: isOrderLoading, error: orderError } = useOrder(orderId, { token });
  const { data: seats = [] } = useSeats(order?.performanceId);
  const initiatePayment = useInitiatePayment({ token });

  // The order's own wire shape only snapshots { seatId, price } per item —
  // row/number/zone come from the seats endpoint, cross-referenced by id.
  const seatSummaries: OrderSeatSummary[] = useMemo(() => {
    if (!order) {
      return [];
    }
    const seatsById = new Map(seats.map((seat) => [seat.id, seat]));
    return order.items.map((item) => {
      const seat = seatsById.get(item.seatId);
      return { seatId: item.seatId, row: seat?.row, number: seat?.number, zone: seat?.zone, price: item.price };
    });
  }, [order, seats]);

  if (isOrderLoading) {
    return <p className={styles.loading}>Loading order…</p>;
  }

  if (orderError || !order) {
    return (
      <p className={styles.error}>
        Order not found{orderError ? `: ${(orderError as Error).message}` : ''}
      </p>
    );
  }

  // The order's totalAmount already includes tax (see the backend's
  // TAX_RATE) — subtotal is derived from the items' snapshotted prices
  // rather than recomputed, so it's exact by construction.
  const subtotal = order.items.reduce((sum, item) => sum + item.price, 0);
  const tax = order.totalAmount - subtotal;

  return (
    <div className={styles.screen}>
      <h1 className={styles.heading}>Order Summary</h1>
      <Card as="section">
        <p className={styles.meta}>
          Order ID: <span className={styles.orderId}>{order.id}</span>
        </p>
        <p className={styles.meta}>Email: {order.email}</p>
        <p className={styles.meta}>Status: {order.status}</p>
        <SeatsSummaryList seats={seatSummaries} />
        <PriceSummary subtotal={subtotal} tax={tax} total={order.totalAmount} />
        {order.status === 'pending' && (
          <>
            {initiatePayment.error && (
              <p className={styles.error}>{(initiatePayment.error as Error).message}</p>
            )}
            <Button
              fullWidth
              disabled={initiatePayment.isPending}
              onClick={() =>
                initiatePayment.mutate(order.id, {
                  onSuccess: (result) => navigate(result.paymentUrl),
                })
              }
            >
              {initiatePayment.isPending ? 'Starting payment…' : 'Continue to Payment'}
            </Button>
          </>
        )}
        {order.status === 'payment_processing' && (
          <Button fullWidth onClick={() => navigate(`/order/${order.id}/payment`)}>
            Resume Payment
          </Button>
        )}
        {order.status === 'completed' && (
          <Button fullWidth onClick={() => navigate(`/order/${order.id}/payment-success`)}>
            View Payment Confirmation
          </Button>
        )}
      </Card>
    </div>
  );
}
