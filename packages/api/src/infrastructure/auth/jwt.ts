import { createSigner, createVerifier } from 'fast-jwt';

/** Decoded payload of a ticketing-system access token. */
export interface JwtPayload {
  userId: string;
}

const ALGORITHM = 'HS256';
const DEFAULT_EXPIRES_IN = '1h';

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return secret;
}

/**
 * Signs a new HS256 JWT encoding `userId`. Expires in 1 hour.
 *
 * @throws {Error} if `JWT_SECRET` is not set.
 */
export function signToken(userId: string): string {
  const sign = createSigner({ key: getSecret(), algorithm: ALGORITHM, expiresIn: DEFAULT_EXPIRES_IN });
  return sign({ userId });
}

/**
 * Verifies `token` and extracts its payload.
 *
 * @returns the decoded payload, or `null` if the token is missing,
 * malformed, signed with the wrong secret/algorithm, or expired. Callers
 * should treat `null` as "unauthenticated" — this function never throws on
 * a bad token, only on misconfiguration.
 * @throws {Error} if `JWT_SECRET` is not set.
 */
export function verifyToken(token: string): JwtPayload | null {
  const verify = createVerifier({ key: getSecret(), algorithms: [ALGORITHM] });
  try {
    const decoded = verify(token);
    if (typeof decoded?.userId !== 'string') {
      return null;
    }
    return { userId: decoded.userId };
  } catch {
    return null;
  }
}
