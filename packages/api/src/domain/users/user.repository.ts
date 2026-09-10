/**
 * Authorization role. `customer` is the default for every signup; `admin` is
 * granted only via `infrastructure/db/seed-admin.ts` — there is no HTTP
 * endpoint that can change this. Declared here (not imported from
 * `infrastructure/db/schema/users.ts`) because the domain layer must not
 * import a specific database driver or ORM.
 */
export type UserRole = 'customer' | 'admin';

/** A registered account, as exposed outside the persistence layer. */
export interface User {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
  role: UserRole;
}

/**
 * Framework-agnostic persistence contract for account creation and lookup.
 * The domain layer depends on this interface only — it must not import a
 * specific database driver or ORM.
 */
export interface IUserRepository {
  /**
   * Creates a new user with the given (already-normalized) email and
   * Argon2 password hash.
   *
   * @throws {EmailAlreadyRegisteredError} if `email` is already registered
   * — whether caught by a pre-check or a concurrent insert racing this one,
   * the database's own unique constraint is the actual source of truth.
   */
  create(email: string, passwordHash: string): Promise<User>;

  /**
   * Reads a single user by (already-normalized) email, including their
   * password hash for verification — or null if no account matches.
   */
  findByEmail(email: string): Promise<(User & { passwordHash: string }) | null>;

  /** Reads a single user by id, or null if it does not exist. */
  findById(userId: string): Promise<User | null>;
}
