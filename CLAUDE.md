# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

`ticketing-system` is a pnpm monorepo for a ticketing platform (events, seats, orders). It's a working MVP: the full guest flow (browse events → pick a performance → select seats → checkout → real Stripe Checkout payment → confirmation) runs end-to-end, backed by real Argon2 password auth, race-safe seat locking, atomic checkout transactions, a webhook-driven payment flow (see "Payments (Stripe)" below), and populated test suites in both `packages/api` and `packages/web`. Claude API integration hasn't started — see "Guidelines for adding features" and the notes throughout this file for what's still open.

## Tech stack

- **Language/runtime**: TypeScript (strict mode, via the shared `tsconfig.base.json`), Node.js, ESM (`"type": "module"` in every package)
- **Package manager**: pnpm workspaces, pinned to `pnpm@11.25.0` via the root `packageManager` field. `pnpm-workspace.yaml` sets `nodeLinker: hoisted`, so there is a single flat `node_modules` at the repo root — do not reintroduce `isolated` mode, it fragments installs into a `node_modules` per package.
- **API** (`packages/api`): Fastify 4, `@fastify/helmet`, `@fastify/cors`, `@fastify/jwt` for auth, `argon2` for password hashing, Zod for validation, `pg` + `drizzle-orm` for PostgreSQL (schema, migrations, and a seed script all exist under `infrastructure/db/`).
- **Dev/test tooling** (`packages/api`): `tsx` for dev watch mode, `vitest`/`@vitest/ui` for tests — `tests/unit` now has real, populated suites for routes and domain logic (see "Testing strategy").
- **Web** (`packages/web`): React 18 + Vite frontend, routed with React Router (`react-router-dom`). Styling is plain CSS Modules — no Tailwind, Sass, PostCSS, or CSS-in-JS. Colors/spacing/typography are provided by a design-token system rather than hardcoded per component — see "Styling and design tokens" below. Data fetching via TanStack Query.
- **Shared** (`packages/shared`): cross-package TypeScript types only, no build step — consumed exclusively via `import type` so both `tsc` (api) and Vite/esbuild (web) erase it at compile time. Do not add runtime values here without adding a real build step.
- **Claude API**: part of the intended stack but not yet integrated anywhere in the codebase — no Anthropic SDK dependency exists in any package yet.

## Repository structure

```
packages/
  api/            @ticketing/api — Fastify backend
    src/
      index.ts              server entrypoint (plugin registration, domain wiring, routes, health check)
      api/routes/           HTTP route handlers — auth.ts, events.ts, orders.ts, payments.ts, seats.ts, webhooks.ts (14 endpoints total)
      domain/                business logic, one subfolder per bounded context
        seats/                seat-lock.ts (SeatLockManager), seat.repository.ts (ISeatRepository) — seat.service.ts exists but is an empty, unused stub
        events/               event-catalog.ts (EventCatalog), event.repository.ts (IEventRepository)
        orders/               order-service.ts (OrderService), order.repository.ts (IOrderRepository)
        payments/             payment.service.ts (IPaymentService) — see "Payments (Stripe)" below
        users/                user-service.ts (UserService), user.repository.ts (IUserRepository), token-signer.ts
        common/errors/        domain-errors.ts — shared domain error types
      infrastructure/
        db/                  Drizzle client/schema/migrations, seed.ts, and drizzle-*.repository.ts implementations of the interfaces above
        payment/              stripe-config.ts, stripe-payment.service.ts (StripePaymentService, implements IPaymentService)
        config/              env/config loading (not scaffolded yet — still empty)
    tests/
      unit/                  real, populated vitest suites (routes + domain); integration/ still unused
  shared/         @ticketing-system/shared — types-only cross-package contracts (no build step)
  web/            @ticketing-system/web — React 18 + Vite frontend, CSS Modules + design tokens
  e2e/            @ticketing-system/e2e — Playwright golden-path test; `pnpm test` runs scripts/run-e2e.ts, giving each run its own throwaway Postgres database (see "Testing strategy")
```

Note the package name inconsistency: `packages/api` is scoped `@ticketing/api`, while `shared` and `web` use `@ticketing-system/*`. Match whichever scope you're extending rather than "fixing" it unprompted.

## Architecture

The API follows a layered, DDD-influenced convention:

- `api/routes` — HTTP layer (Fastify route handlers). Talks to `domain`, not directly to the database.
- `domain/<context>` — framework-free business logic, one folder per bounded context (`seats`, `orders`, `events`, `users`). This layer should not import Fastify, `pg`, or Drizzle.
- `infrastructure` — everything that talks to the outside world: `db` (Drizzle/Postgres), `config` (env loading). Implements interfaces the domain layer depends on, not the other way around.

This is populated now, and is the pattern to copy for a new bounded context: define a repository interface next to its service (e.g. `domain/orders/order.repository.ts` exports `IOrderRepository`, consumed by `OrderService` in `order-service.ts`), then provide the real implementation as a `Drizzle*Repository` class in `infrastructure/db` (e.g. `DrizzleOrderRepository`). `src/index.ts` is where concrete repositories get wired into domain services and registered as routes — read it to see how a new context should be assembled end-to-end.

## Styling and design tokens (`packages/web`)

Colors, spacing, and typography come from a three-tier design-token system under `packages/web/src/styles/`, not hardcoded values in component stylesheets. There is no Figma/design file to source from, so the color primitives come from `@radix-ui/colors` (pre-built, accessibility-checked 12-step scales with matched light/dark pairs) instead of hand-picked hex values — reuse this pattern for any future palette need rather than picking new hex values ad hoc.

- `primitives/colors.css` — pure `@import` of Radix scale files (slate, blue, red, green, amber; light + dark). The only file allowed to reference a Radix primitive directly.
- `primitives/spacing.css`, `typography.css`, `radius.css` — raw numeric scales (`--space-*`, `--font-size-*`, `--font-weight-*`, `--radius-*`), captured from values already in use rather than a speculative grid.
- `semantic.css` — purpose-named tokens (`--color-bg-canvas`, `--color-text-primary`, `--color-danger-text`, etc.) plus seat-status aliases (`--color-seat-{available,reserved,sold,blocked,selected}-*`). Components must consume semantic tokens only — never a Radix primitive or a raw hex/rgb/hsl value.
- `index.css` is the single entry point, imported once from `src/index.tsx`.
- Dark mode is a single `.dark` class on `<html>` (matches Radix's own convention, not a `data-theme` attribute). `styles/theme.ts` exports `setTheme('light' | 'dark')`; no UI toggle is wired up yet.
- `pnpm --filter @ticketing/web check:no-raw-colors` (also runs automatically via `pretest`) fails if a hex/rgb/hsl/oklch color literal appears anywhere in `src/**/*.css` — add or reuse a semantic token instead.

## UI primitives (`packages/web/src/components/ui`)

Shared, reusable components live flat in this folder — currently `Button`, `Card`, `Input`, `BackLink`, re-exported from its `index.ts`. They consume semantic tokens only (see above) and use `clsx` (a real dependency of `packages/web`) to compose variant class names — the pattern to extend, not the hand-rolled template-string concatenation predating it (e.g. in `SeatCard`).

Route containers (screens) live under `web/src/screens/<Route>/`, separate from `components/` — currently Events, Performances, SeatSelection, Checkout, OrderConfirmation, Payment, PaymentSuccess, Login, and Signup.

**Whenever a new view/screen is added, check first whether it can reuse an existing primitive from this folder before writing view-specific styling for a button, card, form field, status badge, or similar generic element.** If the element is generic and plausibly reusable, extend or add to `components/ui` rather than styling it inline for that one screen — even if only one call site exists today (`Input` was added this way, ahead of any consumer, because a text-input primitive was clearly going to be needed). If it's genuinely specific to one feature (e.g. `SeatCard`'s seat-status coloring), keep it local to that feature's own folder instead of forcing it into a generic primitive API.

## Currency formatting (`packages/web/src/utils/currency.ts`)

All prices are stored and passed around as integer cents (`seats.price`, `orders`/`order_items`, DTOs) — there is no currency conversion or multi-currency support, just one shared display formatter. `formatCents(cents)` renders EUR in the continental-European style (`150,00 €`: comma decimal separator, `€` after the number with a space) via `Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })` — `de-DE` and `es-ES` produce identical output for EUR; `de-DE` is used only to avoid implying this is Spain-specific, since Spain, Germany, France, and Italy all share this convention (English-speaking Ireland and the Netherlands don't — `€150.00` and `€ 150,00` respectively).

Always import `formatCents` from this module rather than hand-rolling price formatting — every screen/component that displays a price (`SeatCard`, `SeatSelectionScreen`, `PriceSummary`, `SeatsSummaryList`, `PaymentScreen`) already does this. Note `Intl.NumberFormat` inserts a non-breaking space (U+00A0) before `€`, not a regular space — `getByText`-style test assertions need `.replace(/ /, ' ')` (or an equivalent normalizer) since testing-library's default text normalizer collapses that NBSP to a regular space before comparing.

## Payments (Stripe)

Real Stripe Checkout, test mode — **hosted redirect, not embedded Stripe Elements**. `OrderConfirmationScreen` calls `POST /orders/:orderId/payment-session` (`packages/api/src/api/routes/payments.ts`), which creates a Stripe Checkout Session server-side (amount always taken from the order's own `totalAmount`, never a client-supplied value) and returns a real `checkout.stripe.com` URL. The frontend does a full `window.location.href` redirect, not React Router `navigate` — client-side routing can't leave the SPA. Because Stripe hosts the entire payment form and card data never touches this app's own pages, no Stripe.js/`@stripe/react-stripe-js` is needed on the frontend — don't add it without a real reason to switch to embedded Elements.

**`POST /webhooks/stripe` (`packages/api/src/api/routes/webhooks.ts`) is the only code path that ever marks an order `completed` or `cancelled`** — no client-facing route does either. It re-verifies payment status against Stripe's API directly (`stripe.checkout.sessions.retrieve`) rather than trusting the event payload's own claimed fields, so a correctly-signed-but-tampered event can't fake a payment. `checkout.session.completed` completes the order; `checkout.session.expired` cancels it and releases its seats back to `available` — seats are marked `sold` at order-creation time, not on payment completion (see `domain/orders/order.repository.ts`'s doc comments), so this is a real revert, not just a status flip.

Since the frontend can't observe a server-to-server webhook call, `PaymentScreen` polls `GET /orders/:orderId/payment-status` every 2s (`hooks/usePaymentStatus.ts`) waiting for the webhook to land, capped at ~30 attempts with a manual-retry fallback rather than polling forever. `PaymentSuccessScreen` does one more status check on its own mount before rendering success — landing on that URL isn't itself proof of payment.

Two gotchas worth knowing before touching this code:
- `fastify-raw-body` (registered in `index.ts`) uses `global: false` — only `/webhooks/stripe` gets `request.rawBody`, via `{ config: { rawBody: true } }` on that route specifically. Skip that per-route opt-in and `request.rawBody` is `undefined`, so Stripe's signature verification silently fails on every delivery.
- All order status transitions reuse the existing guarded `IOrderRepository.updateOrderStatus(orderId, fromStatus, toStatus)` (`WHERE status = fromStatus`) — never add an ungated version. That guard is what makes a duplicate webhook delivery (Stripe delivers at-least-once) a safe no-op instead of a race.

Env vars live in the root `.env`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FRONTEND_URL` (used to build the Checkout session's `success_url`/`cancel_url`). `STRIPE_PUBLISHABLE_KEY` is also there but currently unused by any code — nothing needs it without embedded Stripe.js. `STRIPE_WEBHOOK_SECRET` is empty until `stripe listen --forward-to localhost:3000/webhooks/stripe` (or a real deployed endpoint) provides one; the server logs a warning but still starts without it, and webhook deliveries just fail signature verification (400) until it's set.

## Development conventions

- ESM everywhere — no CommonJS (`require`) in `packages/api/src`.
- TypeScript strict mode is enforced via `tsconfig.base.json`; package-level `tsconfig.json` files extend it rather than redefining compiler options.
- No linter or formatter is configured in the repo yet.
- Windows gotcha: a script's "run only if executed directly" guard must compare `import.meta.url` to `pathToFileURL(process.argv[1]).href`, not a raw `` `file://${process.argv[1]}` `` string — `process.argv[1]` uses backslashes on Windows, so the raw-string form silently never matches and the guarded code never runs (see `infrastructure/db/migrate.ts`).

## Testing strategy

- `packages/api` (`tests/unit`) and `packages/web` (co-located `*.test.tsx` next to each screen/component) both have real, populated vitest suites now — pattern-match against those rather than starting from scratch. `packages/api/tests/integration` is still unused.
- Run a package's tests with `pnpm --filter @ticketing/api test` / `pnpm --filter @ticketing/web test` (there is no root-level test aggregation). Run these to see current pass/fail counts rather than trusting a number written down here — that's exactly the kind of claim that goes stale.
- `packages/e2e` has one Playwright golden-path spec (signup → seat selection → checkout → redirect to real Stripe Checkout). `pnpm --filter @ticketing-system/e2e test` runs `scripts/run-e2e.ts`, which creates a uniquely-named Postgres database, runs migrations and the seed script against it, runs Playwright, then drops the database — win or fail. E2E runs no longer touch or pollute the shared dev database (`ticketing_dev`). No Docker is used or planned here — a per-run database already solves the isolation problem, and there's no CI yet to justify the added complexity. If `scripts/run-e2e.ts` fails to create its database, check `E2E_ADMIN_DATABASE_URL` in `.env`: the app's normal DB role may not have `CREATEDB`.
- The golden-path spec deliberately stops at the Stripe redirect rather than completing a purchase — actually finishing payment on Stripe's own hosted page and waiting for the resulting webhook would mean driving a third-party UI this suite doesn't control, plus running `stripe listen` (or an equivalent forwarder) alongside every e2e run. See the spec's own doc comment, and "Payments (Stripe)" below, for the full flow this only partially exercises.

## Package scripts

The root `package.json` has no `scripts` field — there is no `pnpm dev`/`pnpm build` at the workspace root. Run scripts per package with `pnpm --filter <package-name> <script>`, or `pnpm -r <script>` to run it across every workspace package that defines it.

`packages/api` (`@ticketing/api`):
- `dev` — `tsx watch src/index.ts`
- `build` — `tsc`
- `test` — `vitest`
- `start` — `node dist/index.js`
- `db:generate` — `drizzle-kit generate` (generates a migration from schema changes)
- `db:migrate` — `tsx src/infrastructure/db/migrate.ts` (applies pending migrations directly; migrations also run automatically on server startup via `runMigrations()` in `index.ts`)
- `db:seed` — `tsx src/infrastructure/db/seed.ts` (safe to re-run — clears and reinserts catalog data)

`packages/web` (`@ticketing/web`):
- `dev` — `vite`
- `build` — `vite build`
- `preview` — `vite preview`
- `test` — `vitest`
- `check:no-raw-colors` — fails if a hex/rgb/hsl color literal appears in `src/**/*.css` (see "Styling and design tokens"); runs automatically via `pretest`

`packages/e2e` (`@ticketing-system/e2e`):
- `test` — `tsx scripts/run-e2e.ts` (creates an isolated Postgres database, runs migrations/seed, runs Playwright, then drops the database)

`packages/shared` currently defines no scripts.

## Guidelines for adding features

- New business logic goes under `packages/api/src/domain/<bounded-context>/` (create a new subfolder for a new context). Keep it free of Fastify/`pg`/Drizzle imports.
- New HTTP endpoints go under `packages/api/src/api/routes/` and get registered from `src/index.ts`.
- `infrastructure/db` (Drizzle client, schema, migrations) already exists — extend `schema/index.ts` and add a migration via `db:generate` rather than re-scaffolding it.
- The first feature that needs env/config reads will need to scaffold `infrastructure/config` — it's still an empty placeholder directory.
- After adding a dependency to any package, run `pnpm install` from the repo root (not inside the package) so the hoisted root `node_modules` stays consistent.
- New colors in `packages/web`: extend `primitives/colors.css` with another Radix scale, or map a new semantic token in `semantic.css` to an existing one. Never hardcode a hex/rgb/hsl value in a `.module.css` file — see "Styling and design tokens" above.

## Quick Links to Deep Dives
- [Architecture Decisions](./docs/ticketing-architecture-decisions.md)
- [Seat Concurrency Pattern](./docs/1-seat-concurrency-deep-dive.md)
- [Claude Tools Implementation](./docs/2-claude-tools-implementation.md)
- [MCP Server Setup](./docs/3-mcp-server-implementation.md)