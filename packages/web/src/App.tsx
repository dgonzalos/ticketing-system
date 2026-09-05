import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes, useParams } from 'react-router-dom';
import { CheckoutScreen } from './screens/CheckoutScreen';
import { EventsScreen } from './screens/EventsScreen';
import { OrderConfirmationScreen } from './screens/OrderConfirmationScreen';
import { PerformancesScreen } from './screens/PerformancesScreen';
import { SeatSelectionScreen } from './screens/SeatSelectionScreen';
import styles from './App.module.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 5 * 60 * 1000 },
  },
});

/**
 * Keys `SeatSelectionScreen` by `performanceId` so React remounts it (resetting
 * `useSeatSelection`'s local selection state) on any transition between two
 * performances, even one that doesn't pass through a different route in
 * between.
 */
function SeatSelectionRoute() {
  const { performanceId } = useParams<{ performanceId: string }>();
  return <SeatSelectionScreen key={performanceId} />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className={styles.app}>
          <header className={styles.header}>
            <h1>Ticketing System</h1>
          </header>
          <main className={styles.main}>
            <Routes>
              <Route path="/" element={<EventsScreen />} />
              <Route path="/events/:eventId" element={<PerformancesScreen />} />
              <Route path="/events/:eventId/performances/:performanceId" element={<SeatSelectionRoute />} />
              <Route path="/checkout" element={<CheckoutScreen />} />
              <Route path="/order/:orderId" element={<OrderConfirmationScreen />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
