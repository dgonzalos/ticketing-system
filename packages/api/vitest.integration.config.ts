import { defineConfig } from 'vitest/config';

/** Config for `pnpm test:integration` — see `vitest.config.ts`'s doc comment. */
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
  },
});
