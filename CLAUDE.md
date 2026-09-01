# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

`ticketing-system` is a pnpm monorepo for a ticketing platform (events, seats, orders). It is early-stage: the only implemented code is a Fastify server with a single health-check route and an empty seat-lock domain stub. Most of the structure below is scaffolding — folders exist to establish where code should go, not because logic is already there.

## Tech stack

- **Language/runtime**: TypeScript (strict mode, via the shared `tsconfig.base.json`), Node.js, ESM (`"type": "module"` in every package)
- **Package manager**: pnpm workspaces, pinned to `pnpm@11.25.0` via the root `packageManager` field. `pnpm-workspace.yaml` sets `nodeLinker: hoisted`, so there is a single flat `node_modules` at the repo root — do not reintroduce `isolated` mode, it fragments installs into a `node_modules` per package.
- **API** (`packages/api`): Fastify 4, `@fastify/helmet`, `@fastify/cors`, Zod for validation, `pg` + `drizzle-orm` for PostgreSQL. No Drizzle schema/config or migrations exist yet.
- **Dev/test tooling** (`packages/api`): `tsx` for dev watch mode, `vitest`/`@vitest/ui` for tests — no test files are committed yet.
- **Web** (`packages/web`) and **Shared** (`packages/shared`): registered as pnpm workspace packages but currently empty — no dependencies or source. `packages/web` is intended to become a React 18 frontend.
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
  shared/         @ticketing-system/shared — empty, for cross-package types/utilities
  web/            @ticketing-system/web — empty, intended React 18 frontend
```

Note the package name inconsistency: `packages/api` is scoped `@ticketing/api`, while `shared` and `web` use `@ticketing-system/*`. Match whichever scope you're extending rather than "fixing" it unprompted.

## Architecture

The API follows a layered, DDD-influenced convention:

- `api/routes` — HTTP layer (Fastify route handlers). Talks to `domain`, not directly to the database.
- `domain/<context>` — framework-free business logic, one folder per bounded context (`seats`, `orders`, `events`). This layer should not import Fastify, `pg`, or Drizzle.
- `infrastructure` — everything that talks to the outside world: `db` (Drizzle/Postgres), `config` (env loading). Implements interfaces the domain layer depends on, not the other way around.

Since none of this is populated yet, treat it as the target shape when adding the first real feature rather than an existing pattern to copy from example code.

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
