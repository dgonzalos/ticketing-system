import clsx from 'clsx';
import type { OrderSummaryDto } from '@ticketing-system/shared';
import { Badge, ButtonLink, Card, LoadingState, PageHeader, Skeleton } from '../../components/ui';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useMyOrders } from '../../hooks/useMyOrders';
import { formatCents } from '../../utils/currency';
import { formatPerformanceDateTime } from '../../utils/dates';
import { isAwaitingPayment, ORDER_STATUS } from '../../utils/orderStatus';
import styles from './MyTicketsScreen.module.css';

/**
 * Active orders first (paid or still payable), expired ones after them —
 * each group keeps the API's newest-first order (`sort` is stable).
 */
function byActiveFirst(a: OrderSummaryDto, b: OrderSummaryDto): number {
  return Number(a.status === 'cancelled') - Number(b.status === 'cancelled');
}

function OrderCard({ order }: { order: OrderSummaryDto }) {
  const { label, tone } = ORDER_STATUS[order.status];
  const expired = order.status === 'cancelled';
  const { date, time, venue, city } = order.performance;

  return (
    <Card as="article" className={clsx(styles.order, expired && styles.expired)}>
      <div className={styles.heading}>
        <h3 className={styles.title}>{order.event.title}</h3>
        <Badge tone={tone}>{label}</Badge>
      </div>
      <p className={styles.meta}>
        {formatPerformanceDateTime(date, time)} · {venue}, {city}
      </p>
      {/* An expired order's seats went back on sale, so they're not "yours" to list. */}
      {!expired && order.seatLabels.length > 0 && (
        <p className={styles.meta}>
          {order.seatLabels.length === 1 ? 'Seat' : 'Seats'} {order.seatLabels.join(', ')}
        </p>
      )}
      <div className={styles.footer}>
        <span className={styles.total}>{formatCents(order.totalAmount)}</span>
        {isAwaitingPayment(order.status) && (
          <ButtonLink to={`/order/${order.id}`} size="sm">
            Finish payment
          </ButtonLink>
        )}
        {order.status === 'completed' && (
          <ButtonLink to={`/order/${order.id}`} variant="secondary" size="sm">
            View order
          </ButtonLink>
        )}
      </div>
    </Card>
  );
}

/** Route container for `/tickets` (signed-in only): the user's orders, so they can find their tickets again after paying. */
export function MyTicketsScreen() {
  useDocumentTitle('My tickets');
  const { data: orders = [], isLoading, error } = useMyOrders();

  return (
    <div className={styles.screen}>
      <PageHeader title="My tickets" description="Your orders, newest first." />
      {isLoading ? (
        <LoadingState className={styles.list}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height="9rem" radius="card" />
          ))}
        </LoadingState>
      ) : error ? (
        <p className={styles.error}>Failed to load your orders: {(error as Error).message}</p>
      ) : orders.length === 0 ? (
        <div className={styles.empty}>
          <p>No tickets yet.</p>
          <ButtonLink to="/">Browse events</ButtonLink>
        </div>
      ) : (
        <div className={styles.list}>
          {[...orders].sort(byActiveFirst).map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  );
}
