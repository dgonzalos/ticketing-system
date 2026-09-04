import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { SeatMap } from './components/Seats/index.js';
import { Button, Card } from './components/ui/index.js';
import { useDevAuth } from './hooks/useDevAuth.js';
import { useSeatSelection } from './hooks/useSeatSelection.js';
import styles from './App.module.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 5 * 60 * 1000 },
  },
});

// Placeholders until a performances domain and real login exist.
const PERFORMANCE_ID = 'perf-1';
const DEV_USER_ID = 'dev-user';

function SeatSelectionScreen() {
  const { token, error: authError } = useDevAuth(DEV_USER_ID);
  const {
    seats,
    selectedSeatIds,
    totalPrice,
    isSeatsLoading,
    seatsError,
    selectError,
    confirmError,
    onSeatSelect,
    confirmSelection,
    clearSelection,
  } = useSeatSelection({ performanceId: PERFORMANCE_ID, token });

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
    <div className={styles.layout}>
      <SeatMap seats={seats} selectedSeatIds={selectedSeatIds} onSeatSelect={onSeatSelect} />

      <Card as="aside" className={styles.summary}>
        <h2>Your selection</h2>
        <p>{selectedSeatIds.length} seat(s) selected</p>
        <p className={styles.total}>${(totalPrice / 100).toFixed(2)}</p>
        {selectError && <p className={styles.error}>{(selectError as Error).message}</p>}
        {confirmError && <p className={styles.error}>{confirmError.message}</p>}
        <Button
          className={styles.summaryButton}
          fullWidth
          disabled={selectedSeatIds.length === 0}
          onClick={() => void confirmSelection()}
        >
          Confirm purchase
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
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className={styles.app}>
        <header className={styles.header}>
          <h1>Ticketing System</h1>
        </header>
        <main className={styles.main}>
          <SeatSelectionScreen />
        </main>
      </div>
    </QueryClientProvider>
  );
}
