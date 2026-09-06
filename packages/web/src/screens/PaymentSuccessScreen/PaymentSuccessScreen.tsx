import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PriceSummary, SeatsSummaryList } from '../../components/Orders';
import type { OrderSeatSummary } from '../../components/Orders';
import { Button, Card } from '../../components/ui';
import { useDevAuth } from '../../hooks/useDevAuth';
import { useOrder } from '../../hooks/useOrder';
import { useSeats } from '../../hooks/useSeats';
import styles from './PaymentSuccessScreen.module.css';

// Placeholder until real login exists — matches SeatSelectionScreen.
const DEV_USER_ID = 'dev-user';

/**
 * Route container for `/order/:orderId/payment-success`: the final step of
 * the (placeholder) payment flow, shown once the order has actually
 * transitioned to `completed`.
 */
export function PaymentSuccessScreen() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { token, error: authError } = useDevAuth(DEV_USER_ID);
  const { data: order, isLoading: isOrderLoading, error: orderError } = useOrder(orderId, { token });
  const { data: seats = [] } = useSeats(order?.performanceId);

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

  if (authError) {
    return <p className={styles.error}>Failed to authenticate: {authError.message}</p>;
  }

  if (isOrderLoading || !token) {
    return <p className={styles.loading}>Loading order…</p>;
  }

  if (orderError || !order) {
    return (
      <p className={styles.error}>
        Order not found{orderError ? `: ${(orderError as Error).message}` : ''}
      </p>
    );
  }

  const subtotal = order.items.reduce((sum, item) => sum + item.price, 0);
  const tax = order.totalAmount - subtotal;

  return (
    <div className={styles.screen}>
      <h1 className={styles.heading}>✅ Payment Complete!</h1>
      <Card as="section">
        <p className={styles.meta}>
          Order ID: <span className={styles.orderId}>{order.id}</span>
        </p>
        <p className={styles.meta}>Status: {order.status}</p>
        <p className={styles.meta}>Email: {order.email}</p>
        <SeatsSummaryList seats={seatSummaries} />
        <PriceSummary subtotal={subtotal} tax={tax} total={order.totalAmount} />
        <Button fullWidth onClick={() => navigate('/')}>
          Back to Events
        </Button>
      </Card>
    </div>
  );
}
