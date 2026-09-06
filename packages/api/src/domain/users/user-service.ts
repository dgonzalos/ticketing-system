import * as argon2 from 'argon2';
import { InvalidCredentialsError } from '../common/errors/domain-errors.js';
import type { ITokenSigner } from './token-signer.js';
import type { IUserRepository, User } from './user.repository.js';

export type { IUserRepository, User } from './user.repository.js';

/**
 * A password nobody can ever type, hashed once and reused as the verify
 * target when a login's email doesn't match any account. Without this, an
 * unknown email would short-circuit before ever calling `argon2.verify`
 * while a known email with a wrong password pays the full ~100-200ms verify
 * cost — letting an attacker distinguish "no such account" from "wrong
 * password" purely by response time, defeating the point of returning the
 * same error for both.
 */
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  if (!dummyHash) {
    dummyHash = argon2.hash('not-a-real-account-timing-safety-only');
  }
  return dummyHash;
}

/**
 * Account creation and authentication: hashing/verifying passwords with
 * Argon2 and issuing an access token via the injected {@link ITokenSigner}.
 * This class has no knowledge of the database, ORM, JWT library, or web
 * framework in use.
 */
export class UserService {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly tokenSigner: ITokenSigner
  ) {}

  /**
   * Registers a new account and logs it in immediately.
   *
   * Email/password shape (format, minimum length, confirmation match) is
   * validated by the route layer's Zod schema before this is ever called —
   * this method only does what a schema can't: hashing the password and
   * checking/enforcing the email is actually free.
   *
   * @throws {EmailAlreadyRegisteredError} if the email is already registered.
   */
  async signup(email: string, password: string): Promise<{ user: User; token: string }> {
    const normalizedEmail = email.toLowerCase();
    const passwordHash = await argon2.hash(password);
    const user = await this.userRepository.create(normalizedEmail, passwordHash);
    return { user, token: this.tokenSigner.sign(user.id) };
  }

  /**
   * Verifies email + password and logs in on success.
   *
   * @throws {InvalidCredentialsError} if the email doesn't match any
   * account, or the password doesn't match that account's hash — the two
   * cases are indistinguishable to the caller by design.
   */
  async login(email: string, password: string): Promise<{ user: User; token: string }> {
    const row = await this.userRepository.findByEmail(email.toLowerCase());
    const isValid = await argon2.verify(row?.passwordHash ?? (await getDummyHash()), password);
    if (!row || !isValid) {
      throw new InvalidCredentialsError();
    }
    const { passwordHash: _passwordHash, ...user } = row;
    return { user, token: this.tokenSigner.sign(user.id) };
  }
}
