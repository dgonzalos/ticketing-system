import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { BrowserRouter, Link, Route, Routes, useParams } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Button } from './components/ui';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './hooks/useAuth';
import { AdminAssistantScreen } from './screens/AdminAssistantScreen';
import { CheckoutScreen } from './screens/CheckoutScreen';
import { EventsScreen } from './screens/EventsScreen';
import { LoginScreen } from './screens/LoginScreen';
import { OrderConfirmationScreen } from './screens/OrderConfirmationScreen';
import { PaymentScreen } from './screens/PaymentScreen';
import { PaymentSuccessScreen } from './screens/PaymentSuccessScreen';
import { PerformancesScreen } from './screens/PerformancesScreen';
import { SeatSelectionScreen } from './screens/SeatSelectionScreen';
import { SignupScreen } from './screens/SignupScreen';
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
  return <ProtectedRoute element={<SeatSelectionScreen key={performanceId} />} />;
}

/** App header: title, plus the signed-in user's email and a logout button once authenticated. */
function Header() {
  const { user, logout } = useAuth();
  return (
    <header className={styles.header}>
      <h1>Ticketing System</h1>
      {user && (
        <div className={styles.userMenu}>
          {user.role === 'admin' && (
            <Link to="/admin/assistant" className={styles.adminLink}>
              Assistant
            </Link>
          )}
          <span className={styles.userEmail}>{user.email}</span>
          <Button variant="secondary" size="sm" onClick={logout}>
            Log out
          </Button>
        </div>
      )}
    </header>
  );
}

/**
 * Deployment-only notice for the public demo, gated on VITE_DEMO_MODE so
 * it never shows in local dev. Kept inline here rather than promoted to
 * components/ui: it's a single-purpose, env-flag-gated banner with one
 * call site, not a generic reusable element — extracting a primitive for
 * one consumer would be a speculative abstraction (see CLAUDE.md's
 * "genuinely specific to one feature" carve-out for components/ui reuse).
 */
function DemoBanner() {
  if (import.meta.env.VITE_DEMO_MODE !== 'true') {
    return null;
  }
  return (
    <div className={styles.demoBanner}>
      Demo — Stripe test mode. Pay with card 4242 4242 4242 4242, any future expiry, any CVC.
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <div className={styles.app}>
            <DemoBanner />
            <Header />
            <main className={styles.main}>
              <Routes>
                {/* Public — browsing events/performances doesn't require an account. */}
                <Route path="/" element={<EventsScreen />} />
                <Route path="/events/:eventId" element={<PerformancesScreen />} />
                <Route path="/login" element={<LoginScreen />} />
                <Route path="/signup" element={<SignupScreen />} />

                {/* Protected — auth is required starting at seat selection. */}
                <Route path="/events/:eventId/performances/:performanceId" element={<SeatSelectionRoute />} />
                <Route path="/checkout" element={<ProtectedRoute element={<CheckoutScreen />} />} />
                <Route path="/order/:orderId" element={<ProtectedRoute element={<OrderConfirmationScreen />} />} />
                <Route path="/order/:orderId/payment" element={<ProtectedRoute element={<PaymentScreen />} />} />
                <Route
                  path="/order/:orderId/payment-success"
                  element={<ProtectedRoute element={<PaymentSuccessScreen />} />}
                />

                {/* Admin-only */}
                <Route
                  path="/admin/assistant"
                  element={<ProtectedRoute element={<AdminAssistantScreen />} adminOnly />}
                />
              </Routes>
            </main>
          </div>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
