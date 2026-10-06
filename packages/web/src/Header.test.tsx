import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { UserDto } from '@ticketing-system/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Header } from './App';

/** Signed out unless a test sets it. */
let mockUser: UserDto | null = null;

vi.mock('./hooks/useAuth', () => ({
  useAuth: () => ({
    user: mockUser,
    token: mockUser ? 'token' : null,
    isAuthenticated: mockUser !== null,
    isLoading: false,
    logout: vi.fn(),
  }),
}));

afterEach(() => {
  mockUser = null;
});

/** Stand-in for /login that exposes the location state it was navigated with. */
function LoginProbe() {
  const location = useLocation();
  return <pre data-testid="login-state">{JSON.stringify(location.state)}</pre>;
}

function renderHeaderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Header />
      <Routes>
        <Route path="/login" element={<LoginProbe />} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Header', () => {
  it('shows the Seatly wordmark as the page heading, linking home', () => {
    renderHeaderAt('/events/event-1');

    const heading = screen.getByRole('heading', { level: 1, name: 'Seatly' });
    expect(within(heading).getByRole('link', { name: 'Seatly' })).toHaveAttribute('href', '/');
  });

  it('shows guests a Log in link that returns them to the current page', async () => {
    renderHeaderAt('/events/event-1/performances/perf-1');

    await userEvent.click(screen.getByRole('link', { name: 'Log in' }));

    const state = JSON.parse(screen.getByTestId('login-state').textContent ?? 'null');
    expect(state.from.pathname).toBe('/events/event-1/performances/perf-1');
  });

  it('shows a My tickets link only when signed in', () => {
    renderHeaderAt('/');
    expect(screen.queryByRole('link', { name: 'My tickets' })).not.toBeInTheDocument();
  });

  it('links signed-in users to their tickets', () => {
    mockUser = { id: 'user-1', email: 'buyer@example.com', name: null, createdAt: '2026-01-01T00:00:00.000Z', role: 'customer' };
    renderHeaderAt('/');

    expect(screen.getByRole('link', { name: 'My tickets' })).toHaveAttribute('href', '/tickets');
    expect(screen.queryByRole('link', { name: 'Assistant' })).not.toBeInTheDocument();
  });

  it.each(['/login', '/signup'])('hides the Log in link on %s, which has its own form', (pathname) => {
    renderHeaderAt(pathname);

    expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
  });
});
