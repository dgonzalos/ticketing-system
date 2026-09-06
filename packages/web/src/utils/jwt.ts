/**
 * Decodes a JWT's payload without verifying its signature — this is only
 * ever used to sanity-check shape/expiry client-side before trusting a
 * cached value; the server remains the actual authority on validity.
 */
export function decodeJwtPayload(token: string): { exp?: number } | null {
  const [, payload] = token.split('.');
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

/** Whether `token` decodes to a well-formed JWT payload with an `exp` that hasn't passed yet. */
export function isValidToken(token: string): boolean {
  const payload = decodeJwtPayload(token);
  return typeof payload?.exp === 'number' && payload.exp * 1000 > Date.now();
}
