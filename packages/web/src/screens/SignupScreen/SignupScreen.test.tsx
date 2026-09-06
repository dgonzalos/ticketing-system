import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/test-utils';
import { SignupScreen } from './SignupScreen';

const navigateMock = vi.fn();
const signupMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ signup: signupMock, user: null, token: null, isAuthenticated: false, isLoading: false, error: null }),
}));

async function fillAndSubmit(email: string, password: string, passwordConfirm: string) {
  await userEvent.type(screen.getByLabelText('Email address'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.type(screen.getByLabelText('Confirm password'), passwordConfirm);
  await userEvent.click(screen.getByRole('button', { name: 'Sign Up' }));
}

describe('SignupScreen', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders email, password, and confirm-password fields', () => {
    renderWithProviders(<SignupScreen />);

    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
  });

  it('shows an inline error when passwords do not match', async () => {
    renderWithProviders(<SignupScreen />);

    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'something-else');
    await userEvent.tab();

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(signupMock).not.toHaveBeenCalled();
  });

  it('calls signup and navigates home on success', async () => {
    signupMock.mockResolvedValueOnce(undefined);
    renderWithProviders(<SignupScreen />);

    await fillAndSubmit('buyer@example.com', 'correct-horse-battery', 'correct-horse-battery');

    await waitFor(() => {
      expect(signupMock).toHaveBeenCalledWith('buyer@example.com', 'correct-horse-battery', 'correct-horse-battery');
      expect(navigateMock).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('returns to the original page and its location state after a redirected signup', async () => {
    signupMock.mockResolvedValueOnce(undefined);
    renderWithProviders(<SignupScreen />, {
      route: '/signup',
      state: { from: { pathname: '/checkout', search: '', state: { seatIds: ['seat-1'] } } },
    });

    await fillAndSubmit('buyer@example.com', 'correct-horse-battery', 'correct-horse-battery');

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(
        { pathname: '/checkout', search: '' },
        { replace: true, state: { seatIds: ['seat-1'] } }
      );
    });
  });

  it('shows an error message when signup fails (e.g. email already registered)', async () => {
    signupMock.mockRejectedValueOnce(new Error('Email already registered: buyer@example.com'));
    renderWithProviders(<SignupScreen />);

    await fillAndSubmit('buyer@example.com', 'correct-horse-battery', 'correct-horse-battery');

    expect(await screen.findByText('Email already registered: buyer@example.com')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('does not call signup for a password under 8 characters', async () => {
    renderWithProviders(<SignupScreen />);

    await userEvent.type(screen.getByLabelText('Password'), 'short1');
    await userEvent.tab();

    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign Up' })).toBeDisabled();
    expect(signupMock).not.toHaveBeenCalled();
  });

  it('has a working link to login', () => {
    renderWithProviders(<SignupScreen />);

    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  });
});
