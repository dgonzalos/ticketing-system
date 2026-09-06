import type { ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface ProtectedRouteProps {
  element: ReactElement;
}

/**
 * Route guard: renders `element` only once authenticated, otherwise
 * redirects to `/login`, passing the current location so the login screen
 * can send the user back to where they were headed once they log in.
 */
export function ProtectedRoute({ element }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return element;
}
