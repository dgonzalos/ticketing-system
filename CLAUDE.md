# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

`ticketing-system` is a pnpm monorepo for a ticketing platform (events, seats, orders). It is early-stage: the only implemented code is a Fastify server with a single health-check route and an empty seat-lock domain stub. Most of the structure below is scaffolding — folders exist to establish where code should go, not because logic is already there.

## Tech stack

- **Language/runtime**: TypeScript (strict mode, via the shared `tsconfig.base.json`), Node.js, ESM (`"type": "module"` in every package)
- **Package manager**: pnpm workspaces, pinned to `pnpm@11.25.0` via the root `packageManager` field. `pnpm-workspace.yaml` sets `nodeLinker: hoisted`, so there is a single flat `node_modules` at the repo root — do not reintroduce `isolated` mode, it fragments installs into a `node_modules` per package.
- **API** (`packages/api`): Fastify 4, `@fastify/helmet`, `@fastify/cors`, Zod for validation, `pg` + `drizzle-orm` for PostgreSQL. No Drizzle schema/config or migrations exist yet.
- **Dev/test tooling** (`packages/api`): `tsx` for dev watch mode, `vitest`/`@vitest/ui` for tests — no test files are committed yet.
- **Web** (`packages/web`): React 18 + Vite frontend. Styling is plain CSS Modules — no Tailwind, Sass, PostCSS, or CSS-in-JS. Colors/spacing/typography are provided by a design-token system rather than hardcoded per component — see "Styling and design tokens" below. Data fetching via TanStack Query.
- **Shared** (`packages/shared`): cross-package TypeScript types only, no build step — consumed exclusively via `import type` so both `tsc` (api) and Vite/esbuild (web) erase it at compile time. Do not add runtime values here without adding a real build step.
- **Claude API**: part of the intended stack but not yet integrated anywhere in the codebase — no Anthropic SDK dependency exists in any package yet.

## Repository structure

```
packages/
  api/            @ticketing/api — Fastify backend
    src/
      index.ts              server entrypoint (plugin registration, health check)
      api/routes/           HTTP route handlers (empty so far)
      domain/                business logic, one subfolder per bounded context
        seats/seat-lock.ts   only domain file that exists, currently empty
        orders/               empty
        events/               empty
      infrastructure/
        db/                  PostgreSQL/Drizzle access (not scaffolded yet)
        config/              env/config loading (not scaffolded yet)
    tests/
      unit/, integration/    empty, vitest is configured but unused
  shared/         @ticketing-system/shared — types-only cross-package contracts (no build step)
  web/            @ticketing-system/web — React 18 + Vite frontend, CSS Modules + design tokens
```

Note the package name inconsistency: `packages/api` is scoped `@ticketing/api`, while `shared` and `web` use `@ticketing-system/*`. Match whichever scope you're extending rather than "fixing" it unprompted.

## Architecture

The API follows a layered, DDD-influenced convention:

- `api/routes` — HTTP layer (Fastify route handlers). Talks to `domain`, not directly to the database.
- `domain/<context>` — framework-free business logic, one folder per bounded context (`seats`, `orders`, `events`). This layer should not import Fastify, `pg`, or Drizzle.
- `infrastructure` — everything that talks to the outside world: `db` (Drizzle/Postgres), `config` (env loading). Implements interfaces the domain layer depends on, not the other way around.

Since none of this is populated yet, treat it as the target shape when adding the first real feature rather than an existing pattern to copy from example code.

## Styling and design tokens (`packages/web`)

Colors, spacing, and typography come from a three-tier design-token system under `packages/web/src/styles/`, not hardcoded values in component stylesheets. There is no Figma/design file to source from, so the color primitives come from `@radix-ui/colors` (pre-built, accessibility-checked 12-step scales with matched light/dark pairs) instead of hand-picked hex values — reuse this pattern for any future palette need rather than picking new hex values ad hoc.

- `primitives/colors.css` — pure `@import` of Radix scale files (slate, blue, red, green, amber; light + dark). The only file allowed to reference a Radix primitive directly.
- `primitives/spacing.css`, `typography.css`, `radius.css` — raw numeric scales (`--space-*`, `--font-size-*`, `--font-weight-*`, `--radius-*`), captured from values already in use rather than a speculative grid.
- `semantic.css` — purpose-named tokens (`--color-bg-canvas`, `--color-text-primary`, `--color-danger-text`, etc.) plus seat-status aliases (`--color-seat-{available,reserved,sold,blocked,selected}-*`). Components must consume semantic tokens only — never a Radix primitive or a raw hex/rgb/hsl value.
- `index.css` is the single entry point, imported once from `src/index.tsx`.
- Dark mode is a single `.dark` class on `<html>` (matches Radix's own convention, not a `data-theme` attribute). `styles/theme.ts` exports `setTheme('light' | 'dark')`; no UI toggle is wired up yet.
- `pnpm --filter @ticketing/web check:no-raw-colors` (also runs automatically via `pretest`) fails if a hex/rgb/hsl/oklch color literal appears anywhere in `src/**/*.css` — add or reuse a semantic token instead.

## UI primitives (`packages/web/src/components/ui`)

Shared, reusable components live flat in this folder — currently `Button`, `Card`, `Input`, re-exported from its `index.ts`. They consume semantic tokens only (see above) and use `clsx` (a real dependency of `packages/web`) to compose variant class names — the pattern to extend, not the hand-rolled template-string concatenation predating it (e.g. in `SeatCard`).

**Whenever a new view/screen is added, check first whether it can reuse an existing primitive from this folder before writing view-specific styling for a button, card, form field, status badge, or similar generic element.** If the element is generic and plausibly reusable, extend or add to `components/ui` rather than styling it inline for that one screen — even if only one call site exists today (`Input` was added this way, ahead of any consumer, because a text-input primitive was clearly going to be needed). If it's genuinely specific to one feature (e.g. `SeatCard`'s seat-status coloring), keep it local to that feature's own folder instead of forcing it into a generic primitive API.

## Development conventions

- ESM everywhere — no CommonJS (`require`) in `packages/api/src`.
- TypeScript strict mode is enforced via `tsconfig.base.json`; package-level `tsconfig.json` files extend it rather than redefining compiler options.
- No linter or formatter is configured in the repo yet.

## Testing strategy

- `packages/api` has `vitest` and `@vitest/ui` installed and a `test` script, but `tests/unit` and `tests/integration` are both empty — there is no existing test to pattern-match against yet.
- Run a package's tests with `pnpm --filter @ticketing/api test` (there is no root-level test aggregation).

## Package scripts

The root `package.json` has no `scripts` field — there is no `pnpm dev`/`pnpm build` at the workspace root. Run scripts per package with `pnpm --filter <package-name> <script>`, or `pnpm -r <script>` to run it across every workspace package that defines it.

`packages/api` (`@ticketing/api`):
- `dev` — `tsx watch src/index.ts`
- `build` — `tsc`
- `test` — `vitest`
- `start` — `node dist/index.js`

`packages/shared` and `packages/web` currently define no scripts.

## Guidelines for adding features

- New business logic goes under `packages/api/src/domain/<bounded-context>/` (create a new subfolder for a new context). Keep it free of Fastify/`pg`/Drizzle imports.
- New HTTP endpoints go under `packages/api/src/api/routes/` and get registered from `src/index.ts`.
- The first feature that needs persistence will need to scaffold `infrastructure/db` (Drizzle client, schema, config) — it doesn't exist yet.
- The first feature that needs env/config reads will need to scaffold `infrastructure/config` — it doesn't exist yet.
- After adding a dependency to any package, run `pnpm install` from the repo root (not inside the package) so the hoisted root `node_modules` stays consistent.
- New colors in `packages/web`: extend `primitives/colors.css` with another Radix scale, or map a new semantic token in `semantic.css` to an existing one. Never hardcode a hex/rgb/hsl value in a `.module.css` file — see "Styling and design tokens" above.

## Quick Links to Deep Dives
- [Architecture Decisions](./docs/ticketing-architecture-decisions.md)
- [Seat Concurrency Pattern](./docs/1-seat-concurrency-deep-dive.md)
- [Claude Tools Implementation](./docs/2-claude-tools-implementation.md)
- [MCP Server Setup](./docs/3-mcp-server-implementation.md)