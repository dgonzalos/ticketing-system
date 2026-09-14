import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/test-utils';
import { ApiError } from '../../services/http';
import { AdminAssistantScreen } from './AdminAssistantScreen';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ token: 'test-token', user: null, isAuthenticated: true, isLoading: false, error: null }),
}));

vi.mock('../../services/adminAssistantApi');
import * as adminAssistantApi from '../../services/adminAssistantApi';

const composerPlaceholder = 'Ask the assistant…';

const pendingCancelAction = {
  tool: 'cancel_performance' as const,
  command: { performanceId: 'perf-1' },
  summary: 'Cancel performance perf-1',
};

async function sendMessage(text: string) {
  await userEvent.type(screen.getByPlaceholderText(composerPlaceholder), text);
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));
}

describe('AdminAssistantScreen', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders an empty, enabled composer with no messages initially', () => {
    renderWithProviders(<AdminAssistantScreen />);

    expect(screen.getByText('AI Admin Assistant')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(composerPlaceholder)).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('sends a message, appends both sides of the exchange, and re-enables the composer', async () => {
    vi.mocked(adminAssistantApi.sendAssistantMessage).mockResolvedValueOnce({
      conversationId: 'conv-1',
      reply: 'There are 4 events.',
      pendingAction: null,
    });
    renderWithProviders(<AdminAssistantScreen />);

    await sendMessage('how many events?');

    expect(screen.getByText('how many events?')).toBeInTheDocument();
    expect(await screen.findByText('There are 4 events.')).toBeInTheDocument();
    expect(adminAssistantApi.sendAssistantMessage).toHaveBeenCalledWith(
      { conversationId: undefined, message: 'how many events?' },
      'test-token'
    );
    expect(screen.getByPlaceholderText(composerPlaceholder)).toBeEnabled();
  });

  it('renders the pending-action card with the summary and exact command JSON, and disables the composer', async () => {
    vi.mocked(adminAssistantApi.sendAssistantMessage).mockResolvedValueOnce({
      conversationId: 'conv-2',
      reply: "I'd like to: Cancel performance perf-1. Confirm?",
      pendingAction: pendingCancelAction,
    });
    renderWithProviders(<AdminAssistantScreen />);

    await sendMessage('cancel perf-1');

    expect(await screen.findByText('Cancel performance perf-1')).toBeInTheDocument();
    // Default text normalization collapses the <pre>'s newlines/indentation,
    // so match its exact textContent instead of relying on that collapsing.
    expect(
      screen.getByText(JSON.stringify({ performanceId: 'perf-1' }, null, 2), { normalizer: (text) => text })
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText(composerPlaceholder)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('confirming a pending action clears it and appends the confirmation reply', async () => {
    vi.mocked(adminAssistantApi.sendAssistantMessage).mockResolvedValueOnce({
      conversationId: 'conv-3',
      reply: "I'd like to: Cancel performance perf-1. Confirm?",
      pendingAction: pendingCancelAction,
    });
    vi.mocked(adminAssistantApi.respondToPendingAction).mockResolvedValueOnce({
      conversationId: 'conv-3',
      reply: 'Cancelled performance perf-1.',
      pendingAction: null,
    });
    renderWithProviders(<AdminAssistantScreen />);
    await sendMessage('cancel perf-1');
    await screen.findByText('Cancel performance perf-1');

    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Cancelled performance perf-1.')).toBeInTheDocument();
    expect(screen.queryByText('Cancel performance perf-1')).not.toBeInTheDocument();
    expect(adminAssistantApi.respondToPendingAction).toHaveBeenCalledWith(
      { conversationId: 'conv-3', decision: 'confirm' },
      'test-token'
    );
    expect(screen.getByPlaceholderText(composerPlaceholder)).toBeEnabled();
  });

  it('rejecting a pending action clears it and appends the rejection reply', async () => {
    vi.mocked(adminAssistantApi.sendAssistantMessage).mockResolvedValueOnce({
      conversationId: 'conv-4',
      reply: "I'd like to: Cancel performance perf-1. Confirm?",
      pendingAction: pendingCancelAction,
    });
    vi.mocked(adminAssistantApi.respondToPendingAction).mockResolvedValueOnce({
      conversationId: 'conv-4',
      reply: 'Okay, I will not make that change.',
      pendingAction: null,
    });
    renderWithProviders(<AdminAssistantScreen />);
    await sendMessage('cancel perf-1');
    await screen.findByText('Cancel performance perf-1');

    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));

    expect(await screen.findByText('Okay, I will not make that change.')).toBeInTheDocument();
    expect(adminAssistantApi.respondToPendingAction).toHaveBeenCalledWith(
      { conversationId: 'conv-4', decision: 'reject' },
      'test-token'
    );
  });

  it('replaces the composer with the budget-exceeded card on a 429, keeping message history visible', async () => {
    vi.mocked(adminAssistantApi.sendAssistantMessage).mockRejectedValueOnce(
      new ApiError('Daily AI budget of $0.50 reached ($1.00 spent today)', 429)
    );
    renderWithProviders(<AdminAssistantScreen />);

    await sendMessage('hi');

    expect(await screen.findByText(/Daily AI budget reached/)).toBeInTheDocument();
    expect(screen.getByText('hi')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(composerPlaceholder)).not.toBeInTheDocument();
  });

  it('shows a plain-language error, not a raw 409, when a pending action already exists server-side', async () => {
    vi.mocked(adminAssistantApi.sendAssistantMessage).mockRejectedValueOnce(
      new ApiError('Conversation conv-5 has a pending action awaiting confirm/reject', 409)
    );
    renderWithProviders(<AdminAssistantScreen />);

    await sendMessage('another message');

    expect(
      await screen.findByText('There is already a pending action waiting on a decision — confirm or reject it first.')
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText(composerPlaceholder)).toBeEnabled();
  });

  it('treats a 404 on respond as "already resolved" instead of showing a raw error', async () => {
    vi.mocked(adminAssistantApi.sendAssistantMessage).mockResolvedValueOnce({
      conversationId: 'conv-6',
      reply: "I'd like to: Cancel performance perf-1. Confirm?",
      pendingAction: pendingCancelAction,
    });
    vi.mocked(adminAssistantApi.respondToPendingAction).mockRejectedValueOnce(
      new ApiError('No pending action found for conversation: conv-6', 404)
    );
    renderWithProviders(<AdminAssistantScreen />);
    await sendMessage('cancel perf-1');
    await screen.findByText('Cancel performance perf-1');

    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('That action was already resolved.')).toBeInTheDocument();
    expect(screen.queryByText('No pending action found for conversation: conv-6')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancel performance perf-1')).not.toBeInTheDocument();
  });

  it('"New conversation" resets local state back to empty', async () => {
    vi.mocked(adminAssistantApi.sendAssistantMessage).mockResolvedValueOnce({
      conversationId: 'conv-7',
      reply: 'Hello!',
      pendingAction: null,
    });
    renderWithProviders(<AdminAssistantScreen />);
    await sendMessage('hi');
    await screen.findByText('Hello!');

    await userEvent.click(screen.getByRole('button', { name: 'New conversation' }));

    expect(screen.queryByText('hi')).not.toBeInTheDocument();
    expect(screen.queryByText('Hello!')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(composerPlaceholder)).toHaveValue('');
  });
});
