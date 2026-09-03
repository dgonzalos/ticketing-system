import { env } from 'process';
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/infrastructure/db/schema/index.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL || 'postgresql://localhost:5432/ticketing_dev',
  },
} as const satisfies Config;