# Ticketing System

A full-stack ticketing platform — browse events, pick a performance, select seats on a live seat map, and pay through Stripe. Built to explore the parts of this problem that are actually hard: **selling the same seat twice, and trusting a payment that happens on someone else's server.**

**[▶ Live demo](https://ticketing-system-web-eta.vercel.app)** · [CI](https://github.com/dgonzalos/ticketing-system/actions)

[![CI](https://github.com/dgonzalos/ticketing-system/actions/workflows/ci.yml/badge.svg)](https://github.com/dgonzalos/ticketing-system/actions/workflows/ci.yml)

<!-- TODO: screenshot of the seat selection screen goes here — it's the most visual part of the app -->

---

## Try it

| | |
|---|---|
| **Demo account** | `test@test.test` / `ticketing` |
| **Test card** | `4242 4242 4242 4242`, any future expiry, any CVC |

Stripe runs in **test mode** — no real money moves, and no real card is ever accepted.

> **First load may take a few seconds.** The demo runs on free-tier infrastructure that scales to zero when idle. This is a deliberate trade: keeping the database warm would cost roughly four times the free allowance, so the cold start was accepted rather than paid for.

---

## What's interesting here

Most of this is a CRUD app. These four parts aren't.

### Two people click the same seat at the same time

Seat holds are enforced in the database, not in application memory — the check and the claim are one atomic operation, so there is no window between "is this seat free?" and "it's mine now" for a second request to slip through. Seats are marked sold when the **order** is created, not when payment completes, because the moment a customer commits is the moment the seat has to stop being sellable to anyone else.

A full write-up lives in [`docs/1-seat-concurrency-deep-dive.md`](docs/1-seat-concurrency-deep-dive.md).

### The payment happens somewhere this app can't see

Checkout redirects to Stripe's hosted page, so card data never touches this application — which also means the app never directly observes the payment succeeding. Everything follows from that:

- **`POST /webhooks/stripe` is the only code path in the entire codebase that can mark an order `completed` or `cancelled`.** No client-facing route can do either, because a client's word for "I paid" is worth nothing.
- The handler **re-verifies payment status against Stripe's API** rather than trusting the event payload. A correctly-signed event with tampered fields still can't fake a payment.
- Stripe delivers at-least-once, so every status transition is guarded (`WHERE status = fromStatus`). A duplicate delivery is a no-op, not a race.
- An expired checkout session releases its seats back to `available` — a real revert, since they were already sold at order creation.
- The frontend can't watch a server-to-server call, so it polls for the result, capped with a manual-retry fallback rather than spinning forever.

### An AI admin assistant that structurally cannot go rogue

Admins can schedule and cancel performances in natural language. The interesting part is the safety design, not the prompt:

- **Propose, then confirm.** The assistant's message handler can only ever end in a text reply or a *pending proposal*. It has no branch that executes a mutation. A separate confirm step — which makes zero AI calls — is the only path that writes.
- **The tool executor is constructed with the read-only catalog service and nothing else.** It isn't *told* not to write; it holds no reference to anything that can. A bug in the tool-calling loop cannot produce a write.
- **The assistant's tools reuse the same validation schemas as the admin HTTP routes**, so there is never a second, drifting definition of what an admin action accepts.
- Every confirmed, executed action lands in an append-only audit table recording which admin approved it.
- A daily spend guard wraps every AI call. Its limits are [documented honestly](CLAUDE.md#ai-admin-assistant) — it's a soft ceiling, and the reasoning for why that's acceptable is written down rather than glossed over.

*(The assistant is not exposed in the public demo — it can mutate the catalogue and spend API credits.)*

### Authorization that assumes the token is stale

Roles are never baked into the JWT. `requireAdmin` reads the role from the database on every request, because tokens live an hour and a demoted admin shouldn't keep admin rights for the rest of it. There is **no HTTP endpoint that can change a role** — promotion happens through a seed script only, since a "promote me" route is the first thing a reviewer would look for.

---

## Stack

**Backend** — TypeScript (strict), Node, Fastify 4, PostgreSQL + Drizzle ORM, Argon2, Zod, Stripe, Anthropic SDK
**Frontend** — React 18, Vite, React Router, TanStack Query, CSS Modules
**Tooling** — pnpm workspaces, Vitest, Playwright, GitHub Actions
**Hosting** — Vercel (web), Railway (API), Neon (Postgres)

ESM throughout, no CommonJS. No Tailwind, no CSS-in-JS.

### Design tokens, not hex values

Colors, spacing and typography come from a three-tier token system built on [Radix Colors](https://www.radix-ui.com/colors) — accessibility-checked scales with matched light/dark pairs, rather than hand-picked hex values chosen by a backend developer's eye. Components consume purpose-named semantic tokens only (`--color-danger-text`, not `--red-11`), and a check script fails the build if a raw color literal appears anywhere in the stylesheets.

---

## Architecture

A layered, DDD-influenced structure, enforced by dependency direction:

```
api/routes       HTTP layer — Fastify handlers. Talks to domain, never to the database.
domain/<context> Framework-free business logic. No Fastify, no pg, no Drizzle imports.
infrastructure   Everything touching the outside world. Implements interfaces the
                 domain defines — never the other way around.
```

Each bounded context (`seats`, `orders`, `events`, `users`, `ai`) defines its own repository interface next to its service; the concrete Drizzle implementation lives in `infrastructure/db`. Wiring happens in one place, at the entrypoint.

```
packages/
  api/      Fastify backend — 20 endpoints
  web/      React frontend
  shared/   Cross-package types only, no build step
  e2e/      Playwright golden-path suite
```

---

## Running locally

Requires Node 24 (see `.nvmrc`), pnpm, and a PostgreSQL instance.

```bash
pnpm install
cp .env.example .env          # then fill in DATABASE_URL, JWT_SECRET, STRIPE_SECRET_KEY, …

pnpm --filter @ticketing/api db:migrate
pnpm --filter @ticketing/api db:seed

pnpm --filter @ticketing/api dev      # http://localhost:3000
pnpm --filter @ticketing/web dev      # http://localhost:5173
```

To receive Stripe webhooks locally:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

There is no root `dev` script by design — run scripts per package with `pnpm --filter`.

---

## Tests

```bash
pnpm --filter @ticketing/api test               # unit — mocked repositories, no database
pnpm --filter @ticketing/api test:integration   # real SQL behaviour, throwaway database per run
pnpm --filter @ticketing/web test
pnpm --filter @ticketing-system/e2e test        # Playwright golden path
```

Integration and e2e runs each create a uniquely-named PostgreSQL database, migrate it, run against it, and drop it — win or fail. No Docker: a per-run database already solves isolation, and the added complexity wasn't earned.

The e2e spec deliberately stops at the Stripe redirect rather than completing a purchase, because finishing payment means driving a third-party UI this suite doesn't control. That boundary is documented in the spec itself rather than left as a silent gap.

---

## Deeper reading

- [`CLAUDE.md`](CLAUDE.md) — the working architecture document. Decisions, trade-offs, and named scope limits.
- [`docs/1-seat-concurrency-deep-dive.md`](docs/1-seat-concurrency-deep-dive.md)
- [`docs/2-claude-tools-implementation.md`](docs/2-claude-tools-implementation.md)
- [`docs/ticketing-architecture-decisions.md`](docs/ticketing-architecture-decisions.md)

---

## Known limits

Written down deliberately, because a portfolio project that claims to be finished is less believable than one that knows where it stops.

- **No refunds.** Cancelling a performance with sold seats is refused rather than silently stranding a paying customer.
- **Assistant conversations are in-memory**, lost on restart and not shared across instances. The storage interface is already in place for a database-backed swap.
- **The daily AI spend guard is a soft ceiling** — concurrent calls can both pass the check before either records.
- **No linter or formatter** is configured yet.
- **Dark mode tokens exist but no toggle is wired up.**
