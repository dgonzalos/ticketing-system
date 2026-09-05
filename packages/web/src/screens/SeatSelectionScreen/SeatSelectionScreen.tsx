import { useNavigate, useParams } from 'react-router-dom';
import { SeatMap } from '../../components/Seats';
import { BackLink, Button, Card } from '../../components/ui';
import { useDevAuth } from '../../hooks/useDevAuth';
import { useSeatSelection } from '../../hooks/useSeatSelection';
import styles from './SeatSelectionScreen.module.css';

// Placeholder until real login exists.
const DEV_USER_ID = 'dev-user';

/** Route container for `/events/:eventId/performances/:performanceId`: the seat-selection flow for one performance. */
export function SeatSelectionScreen() {
  const { eventId, performanceId } = useParams<{ eventId: string; performanceId: string }>();
  const navigate = useNavigate();
  const { token, error: authError } = useDevAuth(DEV_USER_ID);
  const {
    seats,
    selectedSeatIds,
    totalPrice,
    isSeatsLoading,
    seatsError,
    selectError,
    onSeatSelect,
    clearSelection,
  } = useSeatSelection({ performanceId: performanceId!, token });

  const goToCheckout = () =>
    navigate('/checkout', { state: { performanceId, eventId, seatIds: selectedSeatIds } });

  if (authError) {
    return <p className={styles.error}>Failed to authenticate: {authError.message}</p>;
  }

  if (isSeatsLoading || !token) {
    return <p className={styles.loading}>Loading seats…</p>;
  }

  if (seatsError) {
    return <p className={styles.error}>Failed to load seats: {(seatsError as Error).message}</p>;
  }

  return (
    <div className={styles.screen}>
      <BackLink to={`/events/${eventId}`}>Back to performances</BackLink>
      <div className={styles.layout}>
        <SeatMap seats={seats} selectedSeatIds={selectedSeatIds} onSeatSelect={onSeatSelect} />

        <Card as="aside" className={styles.summary}>
          <h2>Your selection</h2>
          <p>{selectedSeatIds.length} seat(s) selected</p>
          <p className={styles.total}>${(totalPrice / 100).toFixed(2)}</p>
          {selectError && <p className={styles.error}>{(selectError as Error).message}</p>}
          <Button
            className={styles.summaryButton}
            fullWidth
            disabled={selectedSeatIds.length === 0}
            onClick={goToCheckout}
          >
            Checkout
          </Button>
          <Button
            className={styles.summaryButton}
            fullWidth
            variant="secondary"
            disabled={selectedSeatIds.length === 0}
            onClick={clearSelection}
          >
            Clear selection
          </Button>
        </Card>
      </div>
    </div>
  );
}
