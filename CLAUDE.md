# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

`ticketing-system` is a pnpm monorepo for a ticketing platform (events, seats, orders). It's a working MVP: the full guest flow (browse events → pick a performance → select seats → checkout → real Stripe Checkout payment → confirmation) runs end-to-end, backed by real Argon2 password auth, race-safe seat locking, atomic checkout transactions, a webhook-driven payment flow (see "Payments (Stripe)" below), and populated test suites in both `packages/api` and `packages/web`. An AI Admin Assistant (natural-language event/performance scheduling via Claude tool-calling, with every write proposed and human-confirmed, never auto-executed) is complete end-to-end — backend, audit trail, and an admin-only chat screen — see "AI Admin Assistant" below.

## Tech stack

- **Language/runtime**: TypeScript (strict mode, via the shared `tsconfig.base.json`), Node.js, ESM (`"type": "module"` in every package)
- **Package manager**: pnpm workspaces, pinned to `pnpm@11.25.0` via the root `packageManager` field. `pnpm-workspace.yaml` sets `nodeLinker: hoisted`, so there is a single flat `node_modules` at the repo root — do not reintroduce `isolated` mode, it fragments installs into a `node_modules` per package.
- **API** (`packages/api`): Fastify 4, `@fastify/helmet`, `@fastify/cors`, `@fastify/jwt` for auth, `argon2` for password hashing, Zod for validation, `pg` + `drizzle-orm` for PostgreSQL (schema, migrations, and a seed script all exist under `infrastructure/db/`).
- **Dev/test tooling** (`packages/api`): `tsx` for dev watch mode, `vitest`/`@vitest/ui` for tests — `tests/unit` now has real, populated suites for routes and domain logic (see "Testing strategy").
- **Web** (`packages/web`): React 18 + Vite frontend, routed with React Router (`react-router-dom`). Styling is plain CSS Modules — no Tailwind, Sass, PostCSS, or CSS-in-JS. Colors/spacing/typography are provided by a design-token system rather than hardcoded per component — see "Styling and design tokens" below. Data fetching via TanStack Query.
- **Shared** (`packages/shared`): cross-package TypeScript types only, no build step — consumed exclusively via `import type` so both `tsc` (api) and Vite/esbuild (web) erase it at compile time. Do not add runtime values here without adding a real build step.
- **Claude API** (`packages/api`): `@anthropic-ai/sdk` + `zod-to-json-schema` for the AI Admin Assistant's tool-calling layer — see "AI Admin Assistant" below. Reachable via `POST /admin/assistant/messages` and `POST /admin/assistant/respond`, and consumed by `packages/web/src/screens/AdminAssistantScreen/`.

## Repository structure

```
.github/
  workflows/
    ci.yml        install → build API → typecheck/build/check:no-raw-colors/test web → unit test API (see "Continuous integration" below)
.nvmrc            pins Node to 24.20.0 — read by actions/setup-node's node-version-file in CI
packages/
  api/            @ticketing/api — Fastify backend
    src/
      index.ts              server entrypoint (plugin registration, domain wiring, routes, health check)
      api/routes/           HTTP route handlers — auth.ts, events.ts, orders.ts, payments.ts, seats.ts, webhooks.ts, admin/catalog.ts, admin/assistant.ts (20 endpoints total)
      domain/                business logic, one subfolder per bounded context
        seats/                seat-lock.ts (SeatLockManager), seat.repository.ts (ISeatRepository), seat-map.ts (generateSeatMap, shared by seed.ts and EventAdminService) — seat.service.ts exists but is an empty, unused stub
        events/               event-catalog.ts (EventCatalog, read-only), event.repository.ts (IEventRepository), event-admin.service.ts (EventAdminService, write side — see "Admin and authorization" below), catalog-commands.ts (Zod command schemas)
        orders/               order-service.ts (OrderService), order.repository.ts (IOrderRepository)
        payments/             payment.service.ts (IPaymentService) — see "Payments (Stripe)" below
        ai/                   admin-assistant.service.ts (AdminAssistantService), admin-tool-executor.ts (AdminToolExecutor), ai-action-log.repository.ts (IAiActionLogRepository), ai-budget-guard.service.ts (AiBudgetGuard), conversation-store.ts (IConversationStore) — see "AI Admin Assistant" below
        users/                user-service.ts (UserService), user.repository.ts (IUserRepository), token-signer.ts — User now carries a role: 'customer' | 'admin'
        common/errors/        domain-errors.ts — shared domain error types
      infrastructure/
        db/                  Drizzle client/schema/migrations, seed.ts, seed-admin.ts, and drizzle-*.repository.ts implementations of the interfaces above
        payment/              stripe-config.ts, stripe-payment.service.ts (StripePaymentService, implements IPaymentService)
        config/              env/config loading (not scaffolded yet — still empty)
    tests/
      unit/                  real, populated vitest suites (routes + domain), mocked repositories, no DB
      integration/           tests needing real SQL behavior a mocked repository can't exercise; runs against a throwaway per-run Postgres database (see "Testing strategy")
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

Route containers (screens) live under `web/src/screens/<Route>/`, separate from `components/` — currently Events, Performances, SeatSelection, Checkout, OrderConfirmation, Payment, PaymentSuccess, Login, Signup, and AdminAssistant (the only admin-only, `adminOnly`-gated screen so far — see "AI Admin Assistant" below).

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

## Admin and authorization

Accounts carry `role: 'customer' | 'admin'` (`infrastructure/db/schema/users.ts`'s `userRoleEnum`), defaulting to `'customer'` for every signup — `IUserRepository.create(email, passwordHash)` has no role parameter, deliberately, since that path backs the public signup route. There is no HTTP endpoint that can change a role: `pnpm --filter @ticketing/api db:seed-admin` (reads `ADMIN_EMAIL`/`ADMIN_PASSWORD` from the environment, idempotent — creates the account if the email is free, promotes it if not) is the only mechanism, since a "promote me" route is the single most obvious privilege-escalation hole a reviewer would look for in a repo like this.

`requireAdmin` (decorated in `index.ts` alongside `authenticate`) checks role live against the database on every request — `role` is never included in the JWT payload (`types/fastify-jwt.d.ts`'s `payload`/`user` stay `{ userId: string }` only). This is deliberate: tokens live 1h (`infrastructure/auth/jwt.ts`'s `DEFAULT_EXPIRES_IN`), and baking role into the token would mean a demoted admin keeps admin rights until it expires. Protected routes use `onRequest: [app.authenticate, app.requireAdmin]`, in that order (`request.user` doesn't exist until `authenticate` has run), and reply 403 — not 401 or 404 — for an authenticated-but-non-admin caller.

The admin catalog write routes (`api/routes/admin/catalog.ts`) —

- `POST /admin/events`
- `PATCH /admin/events/:eventId`
- `POST /admin/events/:eventId/performances`
- `POST /admin/performances/:performanceId/cancel`

— are built on an explicit command pattern: every admin action is one Zod schema in `domain/events/catalog-commands.ts` plus one `EventAdminService` method that takes the parsed command object, never positional arguments. This is deliberate groundwork for the AI Admin Assistant (see Quick Links below): the assistant will translate natural language into the same command objects these routes already parse and pass to the same service methods, so there's never a second, drifting definition of what an admin action accepts. Routes parse with the *imported* command schemas — never their own inline Zod schema (unlike `auth.ts`'s own convention) — for that same reason. `catalog-commands.ts`'s own doc comment explains why Zod is a deliberate, narrow exception to "domain must be framework-free" (see Architecture above): Zod has no I/O and no framework/storage coupling, and a second consumer outside the HTTP layer (that same future AI layer) is a concrete, named reason for the schemas to live in `domain/` rather than in the routes layer where every other Zod schema in this codebase lives today.

Cancelling a performance is a status flip (`performances.status`, `'scheduled' | 'cancelled'` — see `performanceStatusEnum`), never a delete: performances are referenced by seats, and through them by order_items, so deleting one would violate a foreign key or destroy purchase history. Cancelling also flips the performance's remaining `available` seats to `blocked`, leaving `sold`/`reserved` seats untouched, in the same transaction as the status flip. `EventAdminService.cancelPerformance` refuses (409, `PerformanceHasSalesError`) if any seats have already sold — cancelling would mean refunding real Stripe payments, and no refund path exists yet; cancelling an already-cancelled performance is a no-op. The public `GET /events/:eventId/performances` route only ever returns `scheduled` performances (`listPerformancesByEvent` filters at the repository level) and its DTO mapping strips `status` explicitly, so a cancelled performance's shape can never reach it.

Scheduling performances generates each one's seats in the same all-or-nothing transaction as the performance rows themselves (`DrizzleEventRepository.createPerformances`, mirroring `DrizzleOrderRepository.createOrder`'s transaction template) — a performance with no seats is unsellable. Seat generation itself (`ROWS`, `SEATS_PER_ROW`, price banding) lives in `domain/seats/seat-map.ts`'s `generateSeatMap`, shared with `seed.ts` so the price bands can't drift between dev seeding and runtime performance creation. A caller-supplied `capacity` on a performance is informational only, matching the `capacity` column's existing semantics — it never changes how many seats `generateSeatMap` produces.

## AI Admin Assistant

A natural-language layer over the admin catalog write side (`EventAdminService`), built in four phases, under `packages/api/src/domain/ai/`, `packages/api/src/infrastructure/ai/`, `packages/api/src/api/routes/admin/assistant.ts`, and `packages/web/src/screens/AdminAssistantScreen/`.

**Phase 1 — spend guard** (`ai-budget-guard.service.ts`, `pricing.ts`, `usage-budget.repository.ts`, `infrastructure/db/drizzle-usage-budget.repository.ts`, the `ai_usage_daily` table): `AiBudgetGuard.run()` is the sanctioned way to spend against a daily USD budget — check, call, record, as one call site, so a caller can't skip the check by calling the Anthropic SDK directly. Its own doc comment documents a deliberately unclosed gap: two concurrent calls can both pass the budget check before either records, so the daily figure is a soft ceiling, not a hard cap. That's accepted, not a bug — see Phase 2 below for why.

**Phase 2 — tools, executor, assistant service**: given an admin's natural-language message, the assistant resolves names to ids via read-only tools, proposes a structured write command, and stops. It never executes a mutation itself.

- **The propose-then-confirm flow is the core safety property.** `AdminAssistantService.sendMessage` can only ever end in a final text reply or a `pending` write proposal — never an executed mutation. `AdminAssistantService.respond('confirm')` is the *only* code path that calls `EventAdminService`, and it makes zero Anthropic calls (a deterministic templated reply is built from the result instead) — the single most common action this assistant takes costs nothing extra to confirm. `respond('reject')` likewise never touches `EventAdminService`. This is why Phase 1's soft-ceiling budget gap (above) is acceptable: every write stays a proposal until a human confirms it outside the AI call, so a budget overshoot costs a few cents of extra Anthropic spend, never an extra mutation.
- **`AdminToolExecutor`'s constructor takes `EventCatalog` only — never `EventAdminService`.** This is a structural guarantee, not a convention: the class is physically incapable of writing to the catalog, because nothing ever gives it a reference to the service that can. A bug in `AdminAssistantService`'s tool-calling loop cannot make it execute a mutation.
- **Write-tool schemas are the same Zod schemas `catalog-commands.ts` already defines** for the admin HTTP routes (`admin-tools.ts` builds each tool's `input_schema` from them via `zod-to-json-schema`) — one validated contract, two consumers, per that file's own doc comment. `UpdateEventCommandSchema`'s `.refine()` constraint ("at least one of title/description/imageUrl") can't be represented in the JSON Schema sent to the model — Zod still enforces it (`AdminToolExecutor` re-validates), so a violation costs a wasted retry, not a bad write; the tool's `description` states the rule in prose since that's the only channel left to convey it.
- **`InMemoryConversationStore`** (`infrastructure/ai/in-memory-conversation-store.ts`) is a named scope limit, not an oversight: conversation state is a plain in-process `Map`, lost on restart, shared by nothing across multiple API instances. A Postgres-backed `IConversationStore` implementation is a drop-in swap later — nothing in `AdminAssistantService` needs to change for that.
- **Env vars** (root `.env`): `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_INPUT_PRICE_PER_MTOK`, `ANTHROPIC_OUTPUT_PRICE_PER_MTOK`, `ANTHROPIC_DAILY_BUDGET_USD` — read and validated in `infrastructure/ai/anthropic-config.ts` (`createAnthropicClient`, `readAnthropicRuntimeConfig`, `createAiBudgetGuard`), mirroring `stripe-config.ts`'s factory-function shape. `createAiBudgetGuard` takes the repository as a parameter rather than constructing one itself — this file has no natural access to `db`, so `index.ts` (Phase 3, below) supplies an already-constructed `DrizzleUsageBudgetRepository`. Note `createAnthropicClient()` throws if `ANTHROPIC_API_KEY` is missing — unlike Stripe's warn-and-continue pattern for a missing webhook secret, the server now fails to start at all without it, since Phase 3 wires this unconditionally into `index.ts`.

**Phase 3 — routes, audit log, wiring**: the assistant is now reachable over HTTP, with an accountability trail for every write it actually executes.

- **`POST /admin/assistant/messages`** and **`POST /admin/assistant/respond`** (`api/routes/admin/assistant.ts`), both `onRequest: [app.authenticate, app.requireAdmin]`. `AdminAssistantService.sendMessage`/`respond` return plain reply strings, not a structured result — these routes reconstruct the `{ conversationId, reply, pendingAction }` shape a UI needs by separately reading the *same* `IConversationStore` instance right after the service call returns (`buildTurnResponse`), reshaping `pendingAction` to `{ tool, command, summary }` only (`toolUseId` is an internal Anthropic detail that never reaches the wire). `sendMessage`'s `conversationId` is a required parameter the service never mints — this route generates one via `randomUUID()` when the client omits it, on the first message of a conversation. `respond`'s `adminUserId` argument always comes from `request.user.userId` (the JWT), never the request body. Error mapping: `AiBudgetExceededError` → 429 (both routes); `PendingActionExistsError` → 409 (`messages` only — a message arriving while a proposal is still unresolved); `ConversationNotFoundError` → 404 (`respond` only). `catalog.ts` itself is untouched by this phase — `AdminAssistantService.respond` already absorbs the catalog domain errors (`EventNotFoundError`, `PerformanceHasSalesError`, etc.) internally via `describeDomainFailure`, turning them into a plain-language reply instead of throwing, so there's nothing for these routes to map.
- **`ai_admin_actions` audit table** (`infrastructure/db/schema/ai-admin-actions.ts`, `domain/ai/ai-action-log.repository.ts`'s `IAiActionLogRepository`, `infrastructure/db/drizzle-ai-action-log.repository.ts`): one row per successfully confirmed, successfully *executed* action — never a proposal, a rejection, or a confirmation that hit a domain failure. `AdminAssistantService.respond`'s `'confirm'` success branch is the only call site (`admin-assistant.service.ts`), recording `adminUserId`, `conversationId`, `tool`, `command`, and `resultSummary`. Append-only: no update/delete methods exist because nothing needs them. This is an accountability trail ("what did the assistant change, and which admin approved it"), not a full interaction log — the full conversation still lives in whatever `IConversationStore` is configured.
- **Wiring** (`index.ts`): `createAnthropicClient()`/`readAnthropicRuntimeConfig()`, a `DrizzleUsageBudgetRepository` feeding `createAiBudgetGuard`, an `InMemoryConversationStore`, an `AdminToolExecutor(eventCatalog)`, and a `DrizzleAiActionLogRepository` are all constructed and passed into one `AdminAssistantService`, then `adminAssistantRoutes` is registered with `{ adminAssistantService, conversationStore }` (the *same* store instance the service uses — see above).

**Phase 4 — frontend** (`packages/web`): the first and only admin-facing screen in the app.

- **`screens/AdminAssistantScreen/`** (`/admin/assistant`) is a chat UI: message history, a composer (`Input` + `Button`, reused — no new primitive), and a confirm/reject card rendered only while `pendingAction` is non-null, showing both the plain-language `summary` and the raw `command` (`JSON.stringify(..., null, 2)` in a `<pre>`) so the admin sees exactly what will execute, not a paraphrase. Conversation state (`conversationId`, `messages`, `pendingAction`) is local `useState` only — not persisted, lost on refresh — a deliberate scope limit matching `InMemoryConversationStore`'s own on the backend, not a bug to fix later without also revisiting that backend limit.
- **`ProtectedRoute` gained an optional `adminOnly` prop** (`components/ProtectedRoute.tsx`) rather than a parallel `AdminRoute` component, so the `isLoading`/redirect logic isn't duplicated. A signed-in non-admin hitting an `adminOnly` route redirects to `/` (not `/login` — they're authenticated, just not authorized). This is UX only; `requireAdmin` on the backend is the real enforcement, same relationship as every other client-side check in this app.
- **`services/http.ts` gained `ApiError extends Error`** (carries the HTTP status code), used only by the new `services/adminAssistantApi.ts` — every other API client (`orderApi.ts`, `authApi.ts`, etc.) still throws a plain `Error`, deliberately not retrofitted, since this is the first client that needs to tell a 429 (budget exceeded — its own dedicated UI state) apart from a generic failure.
- **The composer disables itself whenever a `pendingAction` is pending** — the backend's one-pending-action-per-conversation rule (`PendingActionExistsError` → 409) is real and still enforced server-side, but this keeps the 409 rare in practice rather than a normal flow. Same relationship between disabling Confirm/Reject while in flight and the `respond` 404 (`ConversationNotFoundError`) on a double-submit race.

## Development conventions

- ESM everywhere — no CommonJS (`require`) in `packages/api/src`.
- TypeScript strict mode is enforced via `tsconfig.base.json`; package-level `tsconfig.json` files extend it rather than redefining compiler options.
- No linter or formatter is configured in the repo yet.
- Node is pinned to `24.20.0` (matches the dev machine) via root `.nvmrc`; `packages/api`'s `package.json` sets an open-ended `engines.node: ">=22.0.0"` floor (no upper bound, so it never needs an edit on a Node major bump); `packages/api`'s `@types/node` is `^24.0.0` to match. See "Continuous integration" below for where this gets exercised.
- Windows gotcha: a script's "run only if executed directly" guard must compare `import.meta.url` to `pathToFileURL(process.argv[1]).href`, not a raw `` `file://${process.argv[1]}` `` string — `process.argv[1]` uses backslashes on Windows, so the raw-string form silently never matches and the guarded code never runs (see `infrastructure/db/migrate.ts`).

## Continuous integration

`.github/workflows/ci.yml` runs on every push and PR to `main`: install (`pnpm install --frozen-lockfile`) → build the API (`tsc`, doubling as its typecheck) → typecheck/build/`check:no-raw-colors`/test the web package → unit test the API. This is Phase 0 of a larger deployment effort, not a quality gate in the PR-review sense — there's one committer and nothing merges through PRs today. Its actual job is a free, ~2-minute rehearsal of the Linux build a real deploy (Railway) will do, since day-to-day dev happens on Windows: it catches whether `argon2` (a native module) has a prebuilt binary for the pinned Node version or tries to compile from source, whether the lockfile resolves cleanly, and whether `tsc` emits `dist/index.js` at the expected path on a case-sensitive filesystem. Deliberately excludes Postgres service containers, `test:integration`, Playwright/e2e, linting, and any deploy step — see "Testing strategy" below for why those stay a separate, Postgres-backed phase. `pnpm-lock.yaml` is committed (previously gitignored) so `--frozen-lockfile` has something to check against in CI.

## Deployment (live demo)

Phase 1 of the deployment effort the CI section above is Phase 0 of. Three free-tier services, chosen so the demo costs nothing and never asks for a card:

- **Web** — Vercel, `https://ticketing-system-web-eta.vercel.app`
- **API** — Railway, `https://ticketing-system-production-9645.up.railway.app`
- **Postgres** — Neon

**Vercel settings.** Root Directory is `packages/web`; Install Command is left at the default (running `pnpm install` inside a workspace package installs the whole workspace anyway, and Vercel detects pnpm from the root lockfile plus the root `packageManager` field); Build Command is `pnpm --filter @ticketing/web build` (the `--filter` form works regardless of which directory the build starts in); Output Directory is `dist`. This depends on Vercel's **Include source files outside of the Root Directory in the Build Step** option, which is enabled by default for projects created after August 2020 and usually isn't rendered as a visible toggle — don't go looking for it. It matters because `@ticketing-system/shared` has no build step (`main` points straight at `src/index.ts`), so Vite compiles it from source and must read `packages/shared/` from outside the root. `packages/web/vercel.json` holds the SPA rewrite and is picked up from there because Root Directory points at that folder; moving it to the repo root would break it.

**Railway env vars.** `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the `ANTHROPIC_*` set (see "AI Admin Assistant"). `ADMIN_EMAIL`/`ADMIN_PASSWORD` are seed-only and deliberately not set here. `FRONTEND_URL` takes no trailing slash: it is compared against the browser's `Origin` header for CORS *and* used to build Stripe's `success_url`/`cancel_url`, so a wrong value fails in two unrelated-looking ways at once — a CORS error on the catalogue, and a post-payment redirect to a dead host.

**Stripe webhook.** Registered in test mode against `POST /webhooks/stripe` for `checkout.session.completed` and `checkout.session.expired`. In the current dashboard this lives in Workbench under Webhooks, and the button is **Create an event destination** — there is no "Add endpoint" any more, and the flow asks for event types before the URL. Editing an existing destination's URL preserves its signing secret; deleting and recreating issues a new `whsec_` that must then be copied into Railway. An unsigned `POST /webhooks/stripe` returning `400 {"error":"Invalid signature"}` proves only that the route and raw-body capture are wired — a wrong or empty `STRIPE_WEBHOOK_SECRET` returns the same thing. Only a real delivery reaching `200 {"received":true}` distinguishes them.

**Cold starts are accepted, deliberately.** Neon scales to zero after ~5 minutes idle. Holding it awake would draw roughly 400 CU-hours/month against a 100 CU-hour free allowance, so staying warm and staying free are mutually exclusive; the choice was to stay free and let the first request after an idle period take a few seconds. Railway does not work against this — its healthcheck path is called once at the start of a deployment to gate traffic onto the new version, not polled afterwards.

**Do not add an uptime monitor against `/health`.** That endpoint queries the database, so anything polling it (UptimeRobot, Better Stack, a cron ping) holds Neon awake around the clock and exhausts the free allowance in about two weeks. This is the likely way the decision above gets silently reversed later, by someone adding monitoring for unrelated reasons.

## Testing strategy

- `packages/api` (`tests/unit`) and `packages/web` (co-located `*.test.tsx` next to each screen/component) both have real, populated vitest suites now — pattern-match against those rather than starting from scratch.
- Run a package's tests with `pnpm --filter @ticketing/api test` / `pnpm --filter @ticketing/web test` (there is no root-level test aggregation). Run these to see current pass/fail counts rather than trusting a number written down here — that's exactly the kind of claim that goes stale.
- `packages/api/tests/integration` holds tests that need a real database — write one when the behavior under test is actual SQL (e.g. a `Drizzle*Repository` method's `WHERE` clause), which a mocked-interface unit test structurally cannot exercise. `pnpm --filter @ticketing/api test:integration` runs them against a throwaway, uniquely-named Postgres database (`tests/integration/test-db.ts`, mirroring `packages/e2e/scripts/run-e2e.ts`'s create/migrate/drop pattern) — created and dropped per run, never touching `ticketing_dev`. The default `pnpm test` explicitly excludes this folder (see `vitest.config.ts`), so the fast unit loop never requires Postgres to be reachable.
- `packages/e2e` has one Playwright golden-path spec (signup → seat selection → checkout → redirect to real Stripe Checkout). `pnpm --filter @ticketing-system/e2e test` runs `scripts/run-e2e.ts`, which creates a uniquely-named Postgres database, runs migrations and the seed script against it, runs Playwright, then drops the database — win or fail. E2E runs no longer touch or pollute the shared dev database (`ticketing_dev`). No Docker is used or planned here — a per-run database already solves the isolation problem, and there's no CI yet to justify the added complexity. If `scripts/run-e2e.ts` fails to create its database, check `E2E_ADMIN_DATABASE_URL` in `.env`: the app's normal DB role may not have `CREATEDB`.
- The golden-path spec deliberately stops at the Stripe redirect rather than completing a purchase — actually finishing payment on Stripe's own hosted page and waiting for the resulting webhook would mean driving a third-party UI this suite doesn't control, plus running `stripe listen` (or an equivalent forwarder) alongside every e2e run. See the spec's own doc comment, and "Payments (Stripe)" below, for the full flow this only partially exercises.

## Package scripts

The root `package.json` has no `scripts` field — there is no `pnpm dev`/`pnpm build` at the workspace root. Run scripts per package with `pnpm --filter <package-name> <script>`, or `pnpm -r <script>` to run it across every workspace package that defines it.

`packages/api` (`@ticketing/api`):
- `dev` — `tsx watch src/index.ts`
- `build` — `tsc`
- `test` — `vitest` (unit only — excludes `tests/integration`, no DB required; see "Testing strategy")
- `test:integration` — `vitest run --config vitest.integration.config.ts` (needs Postgres reachable; creates/drops its own throwaway database per run)
- `start` — `node dist/index.js`
- `db:generate` — `drizzle-kit generate` (generates a migration from schema changes)
- `db:migrate` — `tsx src/infrastructure/db/migrate.ts` (applies pending migrations directly; migrations also run automatically on server startup via `runMigrations()` in `index.ts`)
- `db:seed` — `tsx src/infrastructure/db/seed.ts` (safe to re-run — clears and reinserts catalog data)
- `db:seed-admin` — `tsx src/infrastructure/db/seed-admin.ts` (idempotent — grants `role: 'admin'` to the account identified by `ADMIN_EMAIL`/`ADMIN_PASSWORD`, creating it if it doesn't exist yet; see "Admin and authorization")

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