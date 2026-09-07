/**
 * Database migration runner.
 * 
 * Runs pending migrations from drizzle/migrations/ against PostgreSQL.
 * Call this on application startup to ensure schema is up-to-date.
 * 
 * Usage:
 * ```typescript
 * import { migrate } from './migrate';
 * await migrate();
 * ```
 */

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './client.js';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations() {
  try {
    console.log('Running database migrations...');
    
    await migrate(db, {
      migrationsFolder: path.join(__dirname, '../../../drizzle/migrations'),
    });
    
    console.log('✅ Migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

// Run migrations if this file is executed directly. Compared as a proper
// file:// URL (not a raw path) so this also works on Windows, where
// process.argv[1] uses backslashes and `file://${process.argv[1]}` would
// never match import.meta.url.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations()
    .then(() => {
      console.log('Done');
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}