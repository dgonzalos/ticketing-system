import type { ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface ProtectedRouteProps {
  element: ReactElement;
  /** When true, also requires `user.role === 'admin'` — redirects a signed-in non-admin to `/` instead of `/login` (they ARE authenticated, just not authorized; sending them to `/login` would be misleading). Real enforcement stays server-side in `requireAdmin` — this is UX only, to avoid rendering a screen that will 403 on its first API call. */
  adminOnly?: boolean;
}

/**
 * Route guard: renders `element` only once authenticated, otherwise
 * redirects to `/login`, passing the current location so the login screen
 * can send the user back to where they were headed once they log in.
 */
export function ProtectedRoute({ element, adminOnly = false }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (adminOnly && user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return element;
}
