import { useEffect } from 'react';
import { BRAND_NAME } from '../brand';

/** "Checkout · Seatly", or just "Seatly" when there's no page name. */
export function formatDocumentTitle(page?: string): string {
  return page ? `${page} · ${BRAND_NAME}` : BRAND_NAME;
}

/**
 * Sets the browser tab title for the current screen. Pass `undefined` while
 * the page name is still loading (e.g. an event's title) to show the brand
 * alone until it arrives.
 */
export function useDocumentTitle(page?: string): void {
  useEffect(() => {
    document.title = formatDocumentTitle(page);
  }, [page]);
}
