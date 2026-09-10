import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Default config for `pnpm test`: unit tests only (mocked repositories, no
 * DB). Integration tests (`tests/integration/**`) hit a real, throwaway
 * Postgres database — see `tests/integration/test-db.ts` — and run
 * separately via `pnpm test:integration` (see `vitest.integration.config.ts`),
 * so the fast default loop never requires Postgres to be reachable.
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'tests/integration/**'],
  },
});
