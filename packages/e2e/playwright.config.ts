import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

// Loads the repo root .env so DATABASE_URL/JWT_SECRET/PORT are set for the
// `webServer` processes below when this config is loaded directly (e.g. `npx
// playwright test` for debugging). The normal `pnpm test` entrypoint is
// scripts/run-e2e.ts, which already sets an isolated DATABASE_URL before this
// file is even loaded — dotenv here won't override that.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    // Performance dates render via `Intl.DateTimeFormat(undefined, ...)` —
    // pinning the locale keeps that text deterministic regardless of the
    // host machine's default locale.
    locale: 'en-US',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @ticketing/api dev',
      url: 'http://localhost:3000/health',
      // Always start fresh against the isolated DATABASE_URL run-e2e.ts sets
      // for this run — reusing an already-running dev server would silently
      // run tests against the dev database instead.
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'pnpm --filter @ticketing/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
