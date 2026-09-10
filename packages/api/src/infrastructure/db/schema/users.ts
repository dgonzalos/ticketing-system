import { index, pgEnum, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Authorization role. `customer` is the default for every signup; `admin` is
 * granted only via `infrastructure/db/seed-admin.ts` — there is no HTTP
 * endpoint that can change this.
 */
export const userRoleEnum = pgEnum('user_role', ['customer', 'admin']);

/** A registered account, authenticated via email + Argon2-hashed password. */
export const usersTable = pgTable(
  'users',
  {
    /** Stable user identifier (UUID), generated at creation time. Never the email — see the doc on `email` below. */
    id: text('id').primaryKey(),

    /**
     * Login identifier. Always stored lowercased (normalized in
     * `UserService`) so `user@example.com` and `User@Example.com` can't
     * become two accounts; the `.unique()` constraint below then enforces
     * that at the database level too.
     */
    email: varchar('email', { length: 255 }).notNull().unique('users_email_unique'),

    /** Argon2 hash (never plaintext) — see `UserService.signup`. */
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),

    /** Optional display name, for a future profile feature — not collected at signup yet. */
    name: varchar('name', { length: 255 }),

    /** Authorization role — see `userRoleEnum` doc above. */
    role: userRoleEnum('role').default('customer').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx: index('users_created_at_idx').on(table.createdAt),
  })
);

/** A user row as read from the database. */
export type User = typeof usersTable.$inferSelect;

/** Shape required to insert a new user row. */
export type NewUser = typeof usersTable.$inferInsert;

/** The set of valid `role` values. */
export type UserRole = (typeof userRoleEnum.enumValues)[number];
