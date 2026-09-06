import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Re-seeds the catalog (events/performances/seats) before the run so specs
 * see deterministic data — see packages/api/src/infrastructure/db/seed.ts,
 * which clears and reinserts it every time it's run.
 *
 * TODO: this currently reuses whatever Postgres DATABASE_URL points at
 * (the local dev DB — see playwright.config.ts's dotenv loading), so every
 * run wipes/reseeds catalog data and each spec's signup adds a real,
 * permanent user row. Give e2e its own dedicated database so runs stop
 * touching dev data/users.
 */
export default async function globalSetup(): Promise<void> {
  execSync('pnpm --filter @ticketing/api db:seed', {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '../..'),
  });
}
