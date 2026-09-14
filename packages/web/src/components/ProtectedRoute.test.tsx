import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from './ProtectedRoute';
import { useAuth } from '../hooks/useAuth';

vi.mock('../hooks/useAuth');

function renderProtected() {
  return render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route path="/login" element={<p>Login Page</p>} />
        <Route path="/protected" element={<ProtectedRoute element={<p>Protected Content</p>} />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderAdminProtected() {
  return render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route path="/" element={<p>Home Page</p>} />
        <Route path="/login" element={<p>Login Page</p>} />
        <Route path="/protected" element={<ProtectedRoute element={<p>Protected Content</p>} adminOnly />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the element when authenticated', () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true, isLoading: false } as ReturnType<typeof useAuth>);

    renderProtected();

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('redirects to /login when not authenticated', () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: false, isLoading: false } as ReturnType<typeof useAuth>);

    renderProtected();

    expect(screen.getByText('Login Page')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('renders nothing while the initial auth check is in flight', () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: false, isLoading: true } as ReturnType<typeof useAuth>);

    renderProtected();

    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
  });

  it('renders the element when adminOnly and the user has role admin', () => {
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'user-1', email: 'admin@example.com', name: null, createdAt: '2026-01-01T00:00:00.000Z', role: 'admin' },
    } as ReturnType<typeof useAuth>);

    renderAdminProtected();

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('redirects to / (not /login) when adminOnly and the signed-in user has role customer', () => {
    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'user-1', email: 'customer@example.com', name: null, createdAt: '2026-01-01T00:00:00.000Z', role: 'customer' },
    } as ReturnType<typeof useAuth>);

    renderAdminProtected();

    expect(screen.getByText('Home Page')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
  });

  it('redirects to / when adminOnly and user is null, rather than throwing on user.role', () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true, isLoading: false, user: null } as ReturnType<typeof useAuth>);

    renderAdminProtected();

    expect(screen.getByText('Home Page')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });
});
