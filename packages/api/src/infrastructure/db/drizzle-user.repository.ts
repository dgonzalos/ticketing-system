import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { EmailAlreadyRegisteredError } from '../../domain/common/errors/domain-errors.js';
import type { IUserRepository, User } from '../../domain/users/user.repository.js';
import * as schema from './schema/index.js';

type UserRow = typeof schema.usersTable.$inferSelect;

/** Postgres error code for a unique-constraint violation. */
const UNIQUE_VIOLATION = '23505';

/** Name of the email unique constraint, matching `schema/users.ts` and its migration. */
const EMAIL_UNIQUE_CONSTRAINT = 'users_email_unique';

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name, createdAt: row.createdAt, role: row.role };
}

/**
 * Whether `err` is (or wraps) a violation of the email unique constraint
 * specifically — not just any unique-constraint violation (e.g. a primary-key
 * collision, or a future unique column), which would also carry code 23505.
 * Drizzle's node-postgres driver wraps the real `pg` error — which carries
 * `.code`/`.constraint` directly — in its own `DrizzleQueryError`, exposing
 * the original on `.cause` rather than on the error itself, so both
 * locations need checking.
 */
function isEmailUniqueViolation(err: unknown): boolean {
  const pgErr = (err as { code?: unknown; constraint?: unknown; cause?: { code?: unknown; constraint?: unknown } });
  const code = pgErr?.code ?? pgErr?.cause?.code;
  const constraint = pgErr?.constraint ?? pgErr?.cause?.constraint;
  return code === UNIQUE_VIOLATION && constraint === EMAIL_UNIQUE_CONSTRAINT;
}

/** Drizzle/PostgreSQL implementation of {@link IUserRepository}. */
export class DrizzleUserRepository implements IUserRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async create(email: string, passwordHash: string): Promise<User> {
    try {
      const [row] = await this.db
        .insert(schema.usersTable)
        .values({ id: randomUUID(), email, passwordHash })
        .returning();
      return toUser(row);
    } catch (err) {
      // Closes the race a pre-check alone can't: two concurrent signups for
      // the same email can both pass an application-level "does this email
      // exist" check before either commits — the database's own unique
      // constraint is what actually decides which one wins.
      if (isEmailUniqueViolation(err)) {
        throw new EmailAlreadyRegisteredError(email);
      }
      throw err;
    }
  }

  async findByEmail(email: string): Promise<(User & { passwordHash: string }) | null> {
    const [row] = await this.db.select().from(schema.usersTable).where(eq(schema.usersTable.email, email));
    return row ? { ...toUser(row), passwordHash: row.passwordHash } : null;
  }

  async findById(userId: string): Promise<User | null> {
    const [row] = await this.db.select().from(schema.usersTable).where(eq(schema.usersTable.id, userId));
    return row ? toUser(row) : null;
  }
}
