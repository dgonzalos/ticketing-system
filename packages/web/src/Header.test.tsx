import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Header } from './App';

vi.mock('./hooks/useAuth', () => ({
  useAuth: () => ({ user: null, token: null, isAuthenticated: false, isLoading: false, logout: vi.fn() }),
}));

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
  it('shows guests a Log in link that returns them to the current page', async () => {
    renderHeaderAt('/events/event-1/performances/perf-1');

    await userEvent.click(screen.getByRole('link', { name: 'Log in' }));

    const state = JSON.parse(screen.getByTestId('login-state').textContent ?? 'null');
    expect(state.from.pathname).toBe('/events/event-1/performances/perf-1');
  });

  it.each(['/login', '/signup'])('hides the Log in link on %s, which has its own form', (pathname) => {
    renderHeaderAt(pathname);

    expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
  });
});
