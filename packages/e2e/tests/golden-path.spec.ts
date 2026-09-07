import { expect, test } from '@playwright/test';

/**
 * The app's golden path end to end, against seeded data (see
 * packages/api/src/infrastructure/db/seed.ts): a guest picks a performance,
 * is prompted to authenticate (seat selection is protected — see App.tsx's
 * routes), and lands back on that *same* performance's seat map rather than
 * the events homepage — exercising `useAuthRedirect`'s fix for `SignupScreen`
 * previously discarding the redirect target entirely. Then completes the
 * (placeholder) purchase as the now-authenticated user.
 */
test('guest signs up when prompted, returns to the same performance, and completes a purchase', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'correct-horse-battery';

  await page.goto('/');
  await page.getByRole('button', { name: /Hamilton/ }).click();

  // Matches perf-1 specifically: it's the only seeded performance on this
  // date (perf-2 is the same venue, a different date, so venue text alone
  // would be ambiguous).
  await page.getByRole('button', { name: /March 14, 2026/ }).click();

  // Seat selection is protected (see App.tsx) — not authenticated yet, so
  // ProtectedRoute redirects to /login.
  await expect(page.getByRole('heading', { name: 'Log In' })).toBeVisible();
  await page.getByRole('link', { name: 'Sign up' }).click();

  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Sign Up' }).click();

  // Regression check for the redirect-state fix: back on *this performance's*
  // seat map, not bounced to '/' and forced to re-navigate from scratch.
  const seat = page.getByRole('button', { name: 'Seat A1, Available, 150,00 €' });
  await seat.click();
  await expect(page.getByText('1 seat(s) selected')).toBeVisible();
  await page.getByRole('button', { name: 'Checkout' }).click();

  // Already authenticated now, so this renders directly — no further redirect.
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Confirm Purchase' }).click();

  await expect(page.getByRole('heading', { name: 'Order Summary' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to Payment' }).click();

  await expect(page.getByRole('heading', { name: 'Processing Payment…' })).toBeVisible();
  await page.waitForURL(/\/payment-success$/, { timeout: 10_000 });

  await expect(page.getByRole('heading', { name: '✅ Payment Complete!' })).toBeVisible();
  await expect(page.getByText('Status: completed')).toBeVisible();
});
