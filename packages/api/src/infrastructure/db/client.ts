import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema/seats.js';

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return url;
}

export const pool = new Pool({ connectionString: getDatabaseUrl() });

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });
