import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { UserDto } from '@ticketing-system/shared';
import * as authApi from '../services/authApi';
import { decodeJwtPayload, isValidToken } from '../utils/jwt';

const TOKEN_STORAGE_KEY = 'auth_token';
const USER_STORAGE_KEY = 'auth_user';

export interface AuthContextValue {
  user: UserDto | null;
  token: string | null;
  isAuthenticated: boolean;
  /** True only for the brief initial tick while localStorage is being read/validated. */
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, passwordConfirm: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

function readCachedUser(): UserDto | null {
  const raw = localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Best-effort: a storage failure (quota exceeded, private-browsing restrictions)
 * should not prevent the caller from treating a successful auth response as
 * successful — it just means the session won't survive a page refresh.
 */
function persist(token: string, user: UserDto): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // ignore — see doc comment above
  }
}

function clearPersisted(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(USER_STORAGE_KEY);
}

/**
 * Provides real signup/login/logout auth state, replacing the old
 * `useDevAuth` dev-only stand-in. Session restore on mount trusts the
 * cached `{ token, user }` in `localStorage` (validating the token's expiry
 * client-side, same as `useDevAuth` did) rather than making a round trip to
 * the server — there's no `GET /auth/me` endpoint, by design (nothing else
 * needs it yet).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cachedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    const cachedUser = readCachedUser();
    if (cachedToken && cachedUser && isValidToken(cachedToken)) {
      setToken(cachedToken);
      setUser(cachedUser);
    } else {
      clearPersisted();
    }
    setIsLoading(false);
  }, []);

  // Real tokens can't be silently refreshed (no refresh-token flow yet) —
  // so unlike `useDevAuth`, which refreshed itself before expiry, this just
  // logs out cleanly once the token actually expires, rather than leaving
  // the UI "authenticated" while every API call silently 401s underneath it.
  useEffect(() => {
    if (!token) {
      return;
    }
    const exp = decodeJwtPayload(token)?.exp;
    if (exp === undefined) {
      return;
    }
    const msUntilExpiry = Math.max(exp * 1000 - Date.now(), 0);
    const timer = setTimeout(() => {
      clearPersisted();
      setToken(null);
      setUser(null);
    }, msUntilExpiry);
    return () => clearTimeout(timer);
  }, [token]);

  const login: AuthContextValue['login'] = useCallback(async (email, password) => {
    setError(null);
    try {
      const result = await authApi.login({ email, password });
      persist(result.token, result.user);
      setToken(result.token);
      setUser(result.user);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  }, []);

  const signup: AuthContextValue['signup'] = useCallback(async (email, password, passwordConfirm) => {
    setError(null);
    try {
      const result = await authApi.signup({ email, password, passwordConfirm });
      persist(result.token, result.user);
      setToken(result.token);
      setUser(result.user);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    clearPersisted();
    setToken(null);
    setUser(null);
    setError(null);
  }, []);

  const value: AuthContextValue = useMemo(
    () => ({
      user,
      token,
      isAuthenticated: token !== null,
      isLoading,
      error,
      login,
      signup,
      logout,
    }),
    [user, token, isLoading, error, login, signup, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
