import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { BrowserRouter, Link, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Button, ButtonLink } from './components/ui';
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
 *
 * Deliberately not wrapped in `ProtectedRoute`: guests may view the seat map
 * and pick seats (kept in the browser only). `SeatSelectionScreen` itself
 * sends a guest to /login when they click Checkout, carrying their picks so
 * they can be reserved on return (see its `goToCheckout`).
 */
function SeatSelectionRoute() {
  const { performanceId } = useParams<{ performanceId: string }>();
  return <SeatSelectionScreen key={performanceId} />;
}

/** Routes that render their own login/signup form — the header's "Log in" link would only duplicate it there. */
const AUTH_PATHS = ['/login', '/signup'];

/**
 * App header: title, theme switcher (always shown), plus a "Log in" link for
 * guests, or the signed-in user's email and a logout button. The "Log in"
 * link carries `{ from: location }` (the same shape `ProtectedRoute` uses) so
 * logging in returns to the current page rather than `/`.
 */
export function Header() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const showLogIn = !user && !AUTH_PATHS.includes(location.pathname);
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <h1>Ticketing System</h1>
        <div className={styles.userMenu}>
          <ThemeSwitcher />
          {showLogIn && (
            <ButtonLink to="/login" state={{ from: location }} variant="secondary" size="sm">
              Log in
            </ButtonLink>
          )}
          {user && (
            <>
              {user.role === 'admin' && (
                <Link to="/admin/assistant" className={styles.adminLink}>
                  Assistant
                </Link>
              )}
              <span className={styles.userEmail}>{user.email}</span>
              <Button variant="secondary" size="sm" onClick={logout}>
                Log out
              </Button>
            </>
          )}
        </div>
      </div>
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
                {/* Public — browsing events, performances, and a performance's seat map doesn't require an account. */}
                <Route path="/" element={<EventsScreen />} />
                <Route path="/events/:eventId" element={<PerformancesScreen />} />
                <Route path="/login" element={<LoginScreen />} />
                <Route path="/signup" element={<SignupScreen />} />
                {/* Public, including picking seats — auth starts at Checkout (SeatSelectionScreen redirects with the picks). */}
                <Route path="/events/:eventId/performances/:performanceId" element={<SeatSelectionRoute />} />

                {/* Protected — everything from checkout onward. */}
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
