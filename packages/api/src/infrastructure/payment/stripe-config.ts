import Stripe from 'stripe';

/**
 * Constructs a Stripe client from `STRIPE_SECRET_KEY`. Exported as a
 * factory (not a bare singleton) so it can be constructor-injected into
 * {@link StripePaymentService} and swapped for a fake in tests, matching
 * this codebase's manual-DI convention elsewhere (e.g. `db`, `jwtTokenSigner`).
 *
 * @throws {Error} if `STRIPE_SECRET_KEY` is not set.
 */
export function createStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY environment variable is required');
  }
  return new Stripe(secretKey);
}
