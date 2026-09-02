import { createSigner } from 'fast-jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signToken, verifyToken } from '../../../../src/infrastructure/auth/jwt.js';

describe('jwt', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
    vi.useRealTimers();
  });

  it('round-trips a signed token back to its payload', () => {
    const token = signToken('user-1');
    expect(verifyToken(token)).toEqual({ userId: 'user-1' });
  });

  it('returns null for a malformed token', () => {
    expect(verifyToken('not-a-jwt')).toBeNull();
  });

  it('returns null for a token signed with a different secret', () => {
    const sign = createSigner({ key: 'other-secret', algorithm: 'HS256' });
    const token = sign({ userId: 'user-1' });

    expect(verifyToken(token)).toBeNull();
  });

  it('returns null for an expired token', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const sign = createSigner({ key: 'test-secret', algorithm: 'HS256', expiresIn: '1s' });
    const token = sign({ userId: 'user-1' });

    vi.setSystemTime(new Date('2026-01-01T00:00:02.000Z'));

    expect(verifyToken(token)).toBeNull();
  });

  it('throws when signing without JWT_SECRET set', () => {
    delete process.env.JWT_SECRET;
    expect(() => signToken('user-1')).toThrow('JWT_SECRET environment variable is not set');
  });

  it('throws when verifying without JWT_SECRET set', () => {
    const token = signToken('user-1');
    delete process.env.JWT_SECRET;
    expect(() => verifyToken(token)).toThrow('JWT_SECRET environment variable is not set');
  });
});
