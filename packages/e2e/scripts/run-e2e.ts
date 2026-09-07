import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { config as loadEnv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const e2eDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(__dirname, '../../..');

// Loads the same root .env the rest of the repo uses, so we have a base
// DATABASE_URL to derive an isolated per-run database from.
loadEnv({ path: path.join(repoRoot, '.env'), quiet: true });

const baseDatabaseUrl = process.env.DATABASE_URL;
if (!baseDatabaseUrl) {
  throw new Error('DATABASE_URL must be set (see repo root .env) to derive the e2e test database.');
}

// CREATE DATABASE/DROP DATABASE require a role with the CREATEDB privilege,
// which the app's normal DATABASE_URL role may not have. E2E_ADMIN_DATABASE_URL
// lets a separate (e.g. superuser) connection be used for just those two
// statements, without granting CREATEDB to the app role. Falls back to
// DATABASE_URL for setups where that role already has the privilege.
const adminDatabaseUrl = process.env.E2E_ADMIN_DATABASE_URL || baseDatabaseUrl;

const dbName = `ticketing_e2e_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

const testDatabaseUrlObj = new URL(baseDatabaseUrl);
testDatabaseUrlObj.pathname = `/${dbName}`;
const testDatabaseUrl = testDatabaseUrlObj.toString();

// The app's own role (from DATABASE_URL) needs to own the new database —
// otherwise, when a different (e.g. superuser) role creates it, Postgres 15+'s
// default "no CREATE on public for non-owners" leaves the app role unable to
// create any tables in it.
const appRole = decodeURIComponent(new URL(baseDatabaseUrl).username);

async function createDatabase(): Promise<void> {
  const admin = new Client({ connectionString: adminDatabaseUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${dbName}" OWNER "${appRole}"`);
  } finally {
    await admin.end();
  }
}

async function dropDatabase(): Promise<void> {
  const admin = new Client({ connectionString: adminDatabaseUrl });
  await admin.connect();
  try {
    // Drop any lingering connections (e.g. a leaked pool from a killed test
    // run) before DROP DATABASE, which otherwise fails while sessions are open.
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [dbName],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  } finally {
    await admin.end();
  }
}

function run(command: string, env: NodeJS.ProcessEnv, cwd: string): void {
  execSync(command, { stdio: 'inherit', cwd, env });
}

async function main(): Promise<number> {
  console.log(`Creating isolated e2e database "${dbName}"...`);
  await createDatabase();

  // Set before Playwright's config module ever loads, so its `webServer`
  // entry for @ticketing/api boots against this database from the start
  // (Playwright starts webServer before running its own globalSetup, so
  // handing off DATABASE_URL from inside globalSetup would be too late).
  const childEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: testDatabaseUrl };

  try {
    run('pnpm --filter @ticketing/api db:migrate', childEnv, repoRoot);
    run('pnpm --filter @ticketing/api db:seed', childEnv, repoRoot);

    console.log(`Running Playwright against isolated database "${dbName}"...`);
    const extraArgs = process.argv.slice(2).join(' ');
    try {
      run(`playwright test ${extraArgs}`.trim(), childEnv, e2eDir);
      return 0;
    } catch (error) {
      const status = (error as { status?: number }).status;
      return typeof status === 'number' ? status : 1;
    }
  } finally {
    console.log(`Dropping isolated e2e database "${dbName}"...`);
    await dropDatabase();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('e2e run failed:', error);
    process.exit(1);
  });
