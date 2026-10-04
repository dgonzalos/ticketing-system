import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoadingState, SLOW_LOAD_MS } from './LoadingState';

const SLOW_NOTE = 'Waking up the demo server — this can take a few seconds on the first visit.';

describe('LoadingState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks the region busy and tells screen readers it is loading', () => {
    const { container } = render(
      <LoadingState>
        <div data-testid="skeleton" />
      </LoadingState>
    );

    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
  });

  it('explains a cold start only once the load has run for 4 seconds', () => {
    render(<LoadingState>{null}</LoadingState>);

    act(() => {
      vi.advanceTimersByTime(SLOW_LOAD_MS - 1);
    });
    expect(screen.queryByText(SLOW_NOTE)).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText(SLOW_NOTE)).toBeInTheDocument();
  });
});
