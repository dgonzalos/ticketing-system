import { expect, test } from '@playwright/test';

/**
 * The app's golden path end to end, against seeded data (see
 * packages/api/src/infrastructure/db/seed.ts): a guest picks a performance
 * and picks a seat without an account (the seat route is public, and a
 * guest's picks stay in the browser — see App.tsx's routes). Clicking
 * Checkout prompts them to authenticate; after signing up their picks are
 * reserved and they land straight on Checkout — exercising
 * `useAuthRedirect`'s state forwarding and `SeatSelectionScreen`'s
 * `pendingSeatIds` reserve-and-continue. Then completes checkout as the
 * now-authenticated user, up through the redirect to Stripe's real hosted
 * Checkout page.
 *
 * Seed dates are relative to the day the seed runs, so performances are
 * targeted by position (the first in the list), never by a literal date.
 *
 * Deliberately stops there rather than completing a purchase on Stripe's
 * own page: actually finishing payment there and waiting for the resulting
 * webhook to land back on this app would mean driving a third-party UI this
 * suite doesn't control, plus running `stripe listen` (or an equivalent
 * forwarder) alongside every e2e run — a much bigger addition to this
 * harness (see CLAUDE.md's "no CI yet, no Docker" scoping) than verifying
 * checkout actually reaches Stripe.
 */
test('guest picks a seat, signs up at checkout, and completes a purchase', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'correct-horse-battery';

  await page.goto('/');
  // Anchored: the card's accessible name is its title *plus* its description,
  // and `^` excludes the hero's "Discover The Lighthouse Keeper →" button.
  await page.getByRole('button', { name: /^The Lighthouse Keeper/ }).click();

  await page.getByRole('group', { name: 'Performances' }).getByRole('button').first().click();

  // A guest can pick seats — kept in the browser, nothing reserved yet.
  await page.getByRole('button', { name: 'Seat A1, Available, 150,00 €' }).click();
  await expect(page.getByText('1 seat(s) selected')).toBeVisible();

  // Checkout is what requires an account.
  await page.getByRole('button', { name: 'Checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Log In' })).toBeVisible();
  await page.getByRole('link', { name: 'Sign up' }).click();

  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Sign Up' }).click();

  // Back on the seat map just long enough to reserve A1 via the
  // pendingSeatIds round trip, then straight on to Checkout.
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Confirm Purchase' }).click();

  await expect(page.getByRole('heading', { name: 'Order Summary' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to Payment' }).click();

  // A real external redirect to Stripe's hosted Checkout — not a route
  // inside this app — so this is as far as this suite drives the flow.
  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//, { timeout: 10_000 });
});
