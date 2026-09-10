/**
 * Grants `role: 'admin'` to one account, identified by `ADMIN_EMAIL` /
 * `ADMIN_PASSWORD` in the environment. Idempotent, safe to re-run:
 *
 * - If no account exists for `ADMIN_EMAIL`, creates one with that password
 *   (Argon2-hashed) and `role: 'admin'`.
 * - If an account already exists for `ADMIN_EMAIL`, promotes it to
 *   `role: 'admin'` and leaves its existing password untouched — this script
 *   grants a role, it does not reset credentials on an existing account.
 *
 * This is deliberately the only way to grant `admin` in this phase — there
 * is no HTTP endpoint for role changes, since a "promote me" route is the
 * single most obvious privilege-escalation hole a reviewer would look for.
 *
 * Usage:
 * ```
 * pnpm --filter @ticketing/api db:seed-admin
 * ```
 */
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { db, pool } from './client.js';
import { usersTable } from './schema/index.js';

async function seedAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required');
  }
  const normalizedEmail = email.toLowerCase();

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));

  if (existing) {
    if (existing.role === 'admin') {
      console.log(`✅ ${normalizedEmail} is already an admin`);
      return;
    }
    await db.update(usersTable).set({ role: 'admin', updatedAt: new Date() }).where(eq(usersTable.id, existing.id));
    console.log(`✅ Promoted ${normalizedEmail} to admin`);
    return;
  }

  const passwordHash = await argon2.hash(password);
  await db.insert(usersTable).values({ id: randomUUID(), email: normalizedEmail, passwordHash, role: 'admin' });
  console.log(`✅ Created admin account ${normalizedEmail}`);
}

seedAdmin()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Admin seed failed:', error);
    return pool.end().finally(() => process.exit(1));
  });
