---
name: ticketing-review
description: Deep, ticketing-domain-specific code review for this repo — concurrency, transactions, state machines, money/pricing, DB, Fastify/React/TypeScript conventions, tests, performance, and architecture. More targeted than the built-in /code-review skill because it knows this codebase's specific invariants. Use when reviewing a diff, branch, or PR in ticketing-system, especially anything touching seats, orders, or payments.
---

# ticketing-review

A code review pass tailored to `ticketing-system`'s actual architecture and
known failure modes, not a generic checklist. Read the repo's `CLAUDE.md`
first if you haven't already this session — it documents the layering
convention, the payment/webhook flow, and the guarded-status-transition
pattern this review leans on heavily.

Review the diff (or the files/branch/PR you're pointed at) against the
categories below. For each finding, cite the concrete failure scenario
(exact input/timing/concurrent-request shape that breaks), not a general
category of concern. Skip a category entirely if nothing in the diff touches
it — don't pad the report.

## Correctness

- Off-by-one/boundary errors, wrong comparison operators, incorrect null/
  undefined handling.
- Zod schemas that don't actually match what the handler assumes downstream
  (e.g. an optional field treated as required, or vice versa).
- Error paths that return a misleading status code or swallow an error
  silently.

## Concurrency

- Any seat- or order-status-changing code path: does it reuse the guarded
  `IOrderRepository.updateOrderStatus(orderId, fromStatus, toStatus)`
  (`WHERE status = fromStatus`) pattern, or does it introduce an ungated
  write? An ungated write on a status field is a near-automatic finding —
  it's what makes duplicate/concurrent triggers (a retried request, a
  duplicate Stripe webhook delivery — Stripe delivers at-least-once) unsafe.
- TOCTOU windows: a read (availability, price, status) followed by a write
  without a transaction or row lock holding the invariant across both.
- Seat lock timing: seats go `sold` at order-creation time, not on payment
  completion — code that assumes availability == unsold, or that releases
  seats without confirming the order/session it's releasing for is still the
  *current* one, is a real oversell risk (see the resume-checkout scenario
  in `infrastructure/payment/stripe-payment.service.ts`'s history for the
  shape of this bug class).

## Transactions

- Multi-statement writes that should be one DB transaction but aren't
  (crash between statements leaves inconsistent state — e.g. a
  `stripe_session_id` recorded but `status` never advanced).
- Transaction handles not actually threaded through to every query inside
  the intended atomic unit (a query silently running outside the
  transaction it looks like it's inside).

## State machines

- `order_status` (and any future status enum): is every transition
  guarded, are all reachable transitions enumerated, is there a transition
  the code assumes can't happen but actually can (e.g. two different events
  racing to move the same order out of `payment_processing`)?

## Money / pricing

- Every amount that reaches a charge, a DB write, or a client-visible total
  must trace back to server-side state, never a client-supplied value.
  Cents-as-integers throughout — flag any float arithmetic on money or any
  place a value crosses from cents to a display unit without going through
  `formatCents`.
- Currency/locale formatting: always `formatCents` from
  `packages/web/src/utils/currency.ts`, never hand-rolled.

## Database

- Drizzle query correctness: joins that silently drop rows, missing
  `WHERE` clauses on multi-tenant-shaped data, N+1 query patterns introduced
  where a single query or a `Promise.all` of independent lookups would do.
- Migrations: does `db:generate` output match the actual schema change; is
  a migration destructive without an explicit reason.

## Fastify / React / TypeScript conventions

- Routes talk to `domain`, not directly to Drizzle/`pg` — flag any route
  handler with a raw query or ORM call in it.
- `domain/<context>` stays framework-free — flag any Fastify, `pg`, or
  Drizzle import inside `domain/`.
- Web: screens (`web/src/screens/<Route>/`) vs. reusable
  `components/ui/` — a new generic UI element (button/card/field/badge)
  styled inline for one screen instead of extended from `components/ui/` is
  a finding, unless it's genuinely feature-specific (e.g. `SeatCard`'s
  seat-status coloring).
- No raw hex/rgb/hsl in `.module.css` — semantic design tokens only.
- ESM only in `packages/api/src` — no `require`.

## Tests

- New behavior without a corresponding test in the package's existing
  pattern (`packages/api/tests/unit/...`, or co-located `*.test.tsx` in
  `packages/web`).
- A test that mocks away the exact thing most likely to break in prod (e.g.
  mocking the DB for a concurrency-sensitive write) — flag as a coverage
  gap even if the mocked test itself passes.

## Performance

- Genuinely wasted round trips (sequential awaits that could be
  `Promise.all`'d, a query re-run per loop iteration) — not micro-
  optimizations with no measurable path relevance.

## Architecture

- Layering violations (domain importing infrastructure/Fastify directly,
  instead of depending on an interface implemented by infrastructure).
- Speculative abstraction: a "shared helper" extracted for a second call
  site that doesn't actually exist yet — recommend skipping unless there
  are 2+ genuine current call sites.

## Delegate security-sensitive changes

For any diff touching authentication, authorization, seat-reservation
concurrency, pricing, payment/webhook handling, or raw user input reaching a
query — **invoke the `security-reviewer` subagent** (adversarial,
exploit-path-focused) rather than trying to cover that ground here. This
skill's categories above catch correctness/architecture issues; that agent
is the one that thinks like an attacker.

## External documentation with Context7

Context7 is available as the preferred source of current library and framework
documentation.

Use Context7 whenever the correctness of a finding depends on the current
behavior, API, configuration, or recommended usage of a dependency.

Examples include:

- React
- React Router
- Fastify
- Drizzle ORM
- PostgreSQL-related Drizzle behavior
- Zod
- Vitest
- Playwright
- Argon2 libraries
- JWT libraries
- Vite

### When to use Context7

Use Context7 when:

- verifying whether an API is being used correctly
- checking library-specific behavior
- checking whether an API is deprecated
- validating configuration
- checking security-sensitive framework behavior
- verifying transaction or ORM semantics
- validating recommended framework patterns
- determining whether behavior changed between library versions
- a potential finding depends on assumptions about a third-party library

Before querying Context7:

1. Inspect the relevant `package.json`.
2. Determine the actual dependency and version used by the project.
3. Query documentation relevant to that library/version when possible.
4. Compare the implementation against the documentation.

### Finding verification

If a potential finding depends on third-party library behavior, do not report it
as confirmed until the relevant behavior has been verified with Context7 when
documentation is available.

For example, do not claim:

"Fastify does not validate this input."

or:

"Drizzle does not keep this operation inside the transaction."

or:

"React Router behaves this way during navigation."

without verifying the relevant framework behavior when that behavior is material
to the finding.

### Avoid unnecessary Context7 usage

Do NOT query Context7 for:

- project-specific business rules
- code that can be understood directly from the repository
- obvious TypeScript logic errors
- application-specific state transitions
- domain invariants documented in `CLAUDE.md`
- issues fully demonstrated by the implementation itself

Context7 should increase confidence, not replace reasoning about the codebase.
