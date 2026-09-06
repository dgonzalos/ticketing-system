/**
 * Framework-agnostic contract for issuing an access token for an
 * authenticated user. The domain layer depends on this interface only — it
 * must not import a specific JWT library or implementation.
 */
export interface ITokenSigner {
  sign(userId: string): string;
}
