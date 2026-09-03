import { useEffect, useState } from 'react';
import { fetchDevToken } from '../services/seatApi';

const TOKEN_STORAGE_KEY = 'ticketing.devToken';
/** Proactively refresh this many ms before the token's actual `exp`. */
const REFRESH_MARGIN_MS = 30_000;

/**
 * Decodes a JWT's payload without verifying its signature — this is only
 * ever used to sanity-check shape/expiry client-side before trusting a
 * cached value; the server remains the actual authority on validity.
 */
function decodeJwtPayload(token: string): { exp?: number } | null {
  const [, payload] = token.split('.');
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

/** Whether `token` decodes to a well-formed JWT payload with an `exp` that hasn't passed yet. */
function isValidToken(token: string): boolean {
  const payload = decodeJwtPayload(token);
  return typeof payload?.exp === 'number' && payload.exp * 1000 > Date.now();
}

/**
 * Placeholder auth for local development. There is no login flow yet, so
 * this exchanges a fixed `userId` for a JWT via the backend's `/auth/dev-token`
 * route (itself dev-only, see `api/routes/auth.ts`) and caches it in
 * `localStorage`. Replace with real session/login handling once that exists.
 *
 * A cached value is never trusted blindly: it's decoded and expiry-checked
 * both on load (a malformed or already-expired value is discarded, not
 * cached forever) and proactively via a timer while the token is in use, so
 * a long-lived open tab still refreshes before the 1h JWT expiry rather
 * than silently 401ing on every request afterward.
 */
export function useDevAuth(userId: string) {
  const [token, setToken] = useState<string | null>(() => {
    const cached = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (cached && isValidToken(cached)) {
      return cached;
    }
    if (cached) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
    return null;
  });
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (token) {
      return;
    }
    fetchDevToken(userId)
      .then((newToken) => {
        if (!isValidToken(newToken)) {
          throw new Error('Received an invalid or already-expired token from /auth/dev-token');
        }
        localStorage.setItem(TOKEN_STORAGE_KEY, newToken);
        setError(null);
        setToken(newToken);
      })
      .catch((err: Error) => setError(err));
  }, [token, userId]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const exp = decodeJwtPayload(token)?.exp;
    if (exp === undefined) {
      return;
    }
    const msUntilRefresh = Math.max(exp * 1000 - Date.now() - REFRESH_MARGIN_MS, 0);
    const timer = setTimeout(() => {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      setToken(null);
    }, msUntilRefresh);
    return () => clearTimeout(timer);
  }, [token]);

  return { userId, token, isLoading: !token && !error, error };
}
