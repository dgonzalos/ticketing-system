import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserDto } from '@ticketing-system/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from './AuthContext';
import { useAuth } from '../hooks/useAuth';
import * as authApi from '../services/authApi';

vi.mock('../services/authApi');

const user: UserDto = {
  id: 'user-1',
  email: 'buyer@example.com',
  name: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  role: 'customer',
};

/** Signs the given payload with a fake header/signature so `exp` is decodable — the test never verifies the signature. */
function fakeToken(exp: number): string {
  const header = btoa(JSON.stringify({ alg: 'none' }));
  const payload = btoa(JSON.stringify({ userId: 'user-1', exp }));
  return `${header}.${payload}.signature`;
}

function TestConsumer() {
  const { user: currentUser, isAuthenticated, isLoading, error, login, signup, logout } = useAuth();
  return (
    <div>
      <p>isLoading: {String(isLoading)}</p>
      <p>isAuthenticated: {String(isAuthenticated)}</p>
      <p>email: {currentUser?.email ?? 'none'}</p>
      <p>error: {error ?? 'none'}</p>
      {/* login/signup reject on failure by design (see AuthContext) — swallowed here since this
          consumer only cares about the resulting context state, not the rejection itself. */}
      <button onClick={() => login('buyer@example.com', 'correct-horse-battery').catch(() => {})}>Login</button>
      <button onClick={() => signup('buyer@example.com', 'correct-horse-battery', 'correct-horse-battery').catch(() => {})}>
        Signup
      </button>
      <button onClick={() => logout()}>Logout</button>
    </div>
  );
}

function renderWithAuthProvider() {
  return render(
    <AuthProvider>
      <TestConsumer />
    </AuthProvider>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('starts logged out when localStorage is empty', async () => {
    renderWithAuthProvider();

    expect(await screen.findByText('isAuthenticated: false')).toBeInTheDocument();
    expect(screen.getByText('email: none')).toBeInTheDocument();
  });

  it('restores a valid cached session from localStorage without calling the API', async () => {
    localStorage.setItem('auth_token', fakeToken(Date.now() / 1000 + 3600));
    localStorage.setItem('auth_user', JSON.stringify(user));

    renderWithAuthProvider();

    expect(await screen.findByText('isAuthenticated: true')).toBeInTheDocument();
    expect(screen.getByText('email: buyer@example.com')).toBeInTheDocument();
    expect(authApi.login).not.toHaveBeenCalled();
    expect(authApi.signup).not.toHaveBeenCalled();
  });

  it('discards an expired cached token and starts logged out', async () => {
    localStorage.setItem('auth_token', fakeToken(Date.now() / 1000 - 60));
    localStorage.setItem('auth_user', JSON.stringify(user));

    renderWithAuthProvider();

    expect(await screen.findByText('isAuthenticated: false')).toBeInTheDocument();
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('auth_user')).toBeNull();
  });

  it('login persists the session and updates state', async () => {
    vi.mocked(authApi.login).mockResolvedValueOnce({ user, token: fakeToken(Date.now() / 1000 + 3600) });
    renderWithAuthProvider();
    await screen.findByText('isAuthenticated: false');

    await userEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(await screen.findByText('isAuthenticated: true')).toBeInTheDocument();
    expect(localStorage.getItem('auth_token')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('auth_user')!)).toEqual(user);
  });

  it('login failure surfaces the error and stays logged out', async () => {
    vi.mocked(authApi.login).mockRejectedValueOnce(new Error('Invalid email or password'));
    renderWithAuthProvider();
    await screen.findByText('isAuthenticated: false');

    await userEvent.click(screen.getByRole('button', { name: 'Login' }));

    expect(await screen.findByText('error: Invalid email or password')).toBeInTheDocument();
    expect(screen.getByText('isAuthenticated: false')).toBeInTheDocument();
  });

  it('signup persists the session and updates state', async () => {
    vi.mocked(authApi.signup).mockResolvedValueOnce({ user, token: fakeToken(Date.now() / 1000 + 3600) });
    renderWithAuthProvider();
    await screen.findByText('isAuthenticated: false');

    await userEvent.click(screen.getByRole('button', { name: 'Signup' }));

    expect(await screen.findByText('isAuthenticated: true')).toBeInTheDocument();
  });

  it('logout clears state and localStorage', async () => {
    localStorage.setItem('auth_token', fakeToken(Date.now() / 1000 + 3600));
    localStorage.setItem('auth_user', JSON.stringify(user));
    renderWithAuthProvider();
    await screen.findByText('isAuthenticated: true');

    await userEvent.click(screen.getByRole('button', { name: 'Logout' }));

    expect(await screen.findByText('isAuthenticated: false')).toBeInTheDocument();
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('auth_user')).toBeNull();
  });
});
