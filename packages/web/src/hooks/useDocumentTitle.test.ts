import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatDocumentTitle, useDocumentTitle } from './useDocumentTitle';

describe('formatDocumentTitle', () => {
  it('puts the page name before the brand', () => {
    expect(formatDocumentTitle('Checkout')).toBe('Checkout · Seatly');
  });

  it('is just the brand without a page name', () => {
    expect(formatDocumentTitle()).toBe('Seatly');
  });
});

describe('useDocumentTitle', () => {
  it('sets the tab title, and updates it when the page name arrives', () => {
    const { rerender } = renderHook(({ page }: { page?: string }) => useDocumentTitle(page), {
      initialProps: { page: undefined as string | undefined },
    });
    expect(document.title).toBe('Seatly');

    rerender({ page: 'The Lighthouse Keeper' });
    expect(document.title).toBe('The Lighthouse Keeper · Seatly');
  });
});
