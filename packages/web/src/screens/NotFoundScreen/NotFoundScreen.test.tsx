import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/test-utils';
import { NotFoundScreen } from './NotFoundScreen';

describe('NotFoundScreen', () => {
  it('says the page is missing, links back to the events, and sets the tab title', () => {
    renderWithProviders(<NotFoundScreen />, { route: '/nope' });

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse events' })).toHaveAttribute('href', '/');
    expect(document.title).toBe('Page not found · Seatly');
  });
});
