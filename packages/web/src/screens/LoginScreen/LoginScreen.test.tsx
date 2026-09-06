import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/test-utils';
import { LoginScreen } from './LoginScreen';

const navigateMock = vi.fn();
const loginMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ login: loginMock, user: null, token: null, isAuthenticated: false, isLoading: false, error: null }),
}));

async function fillAndSubmit(email: string, password: string) {
  await userEvent.type(screen.getByLabelText('Email address'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Log In' }));
}

describe('LoginScreen', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders email and password fields', () => {
    renderWithProviders(<LoginScreen />);

    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log In' })).toBeInTheDocument();
  });

  it('calls login and navigates home on success', async () => {
    loginMock.mockResolvedValueOnce(undefined);
    renderWithProviders(<LoginScreen />);

    await fillAndSubmit('buyer@example.com', 'correct-horse-battery');

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('buyer@example.com', 'correct-horse-battery');
      expect(navigateMock).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('shows an error message when login fails', async () => {
    loginMock.mockRejectedValueOnce(new Error('Invalid email or password'));
    renderWithProviders(<LoginScreen />);

    await fillAndSubmit('buyer@example.com', 'wrong-password');

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('does not call login for an invalid email', async () => {
    renderWithProviders(<LoginScreen />);

    await fillAndSubmit('not-an-email', 'correct-horse-battery');

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('has a working link to signup', () => {
    renderWithProviders(<LoginScreen />);

    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/signup');
  });
});
