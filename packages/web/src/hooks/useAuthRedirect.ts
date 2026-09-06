import { useLocation, useNavigate } from 'react-router-dom';

interface AuthRedirectState {
  from?: { pathname: string; search: string; state?: unknown };
}

/**
 * Returns the user to wherever `ProtectedRoute` redirected them from after a
 * successful login/signup — preserving that original route's own location
 * state (e.g. CheckoutScreen's in-progress seat selection) — or to `/` if
 * they arrived at /login or /signup directly rather than via a redirect.
 */
export function useAuthRedirect(): () => void {
  const navigate = useNavigate();
  const location = useLocation();

  return () => {
    const from = (location.state as AuthRedirectState | null)?.from;
    navigate(from ? { pathname: from.pathname, search: from.search } : '/', {
      replace: true,
      state: from?.state,
    });
  };
}
