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
import { fileURLToPath } from 'url';

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

// Run migrations if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
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