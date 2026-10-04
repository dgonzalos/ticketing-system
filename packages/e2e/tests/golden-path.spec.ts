import { expect, test } from '@playwright/test';

/**
 * The app's golden path end to end, against seeded data (see
 * packages/api/src/infrastructure/db/seed.ts): a guest picks a performance
 * and sees its seat map and prices without an account (the seat route is
 * public — see App.tsx's routes). Choosing a seat prompts them to
 * authenticate; after signing up they land back on that *same* seat map with
 * the seat they clicked already selected — exercising `useAuthRedirect`'s
 * state forwarding and `SeatSelectionScreen`'s `pendingSeatId` auto-select.
 * Then starts checkout as the now-authenticated user, up through the
 * redirect to Stripe's real hosted Checkout page.
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
test('guest browses the seat map, signs up when choosing a seat, and completes a purchase', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'correct-horse-battery';

  await page.goto('/');
  // Anchored: the card's accessible name is its title *plus* its description,
  // and `^` excludes the hero's "Discover The Lighthouse Keeper →" button.
  await page.getByRole('button', { name: /^The Lighthouse Keeper/ }).click();

  await page.getByRole('group', { name: 'Performances' }).getByRole('button').first().click();

  // The seat map is public — a guest sees seats and prices before logging in.
  // Choosing a seat is what requires an account.
  await page.getByRole('button', { name: 'Seat A1, Available, 150,00 €' }).click();

  await expect(page.getByRole('heading', { name: 'Log In' })).toBeVisible();
  await page.getByRole('link', { name: 'Sign up' }).click();

  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Sign Up' }).click();

  // Back on *this performance's* seat map with A1 already selected via the
  // pendingSeatId round trip. Don't click A1 again — that would unlock it.
  await expect(page.getByText('1 seat(s) selected')).toBeVisible();
  await page.getByRole('button', { name: 'Checkout' }).click();

  // Already authenticated now, so this renders directly — no further redirect.
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Confirm Purchase' }).click();

  await expect(page.getByRole('heading', { name: 'Order Summary' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to Payment' }).click();

  // A real external redirect to Stripe's hosted Checkout — not a route
  // inside this app — so this is as far as this suite drives the flow.
  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//, { timeout: 10_000 });
});
