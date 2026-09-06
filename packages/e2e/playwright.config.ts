import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

// Loads the repo root .env so DATABASE_URL/JWT_SECRET/PORT are set for the
// `webServer` processes below and for `global-setup.ts`'s seed run — nothing
// else in the repo loads it (packages/api reads process.env directly), and
// this is the one place that needs to work regardless of how the caller's
// shell is configured.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  globalSetup: './global-setup.ts',
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
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'pnpm --filter @ticketing/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
