import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authRoutes } from '../../../../src/api/routes/auth.js';
import { EmailAlreadyRegisteredError, InvalidCredentialsError } from '../../../../src/domain/common/errors/domain-errors.js';
import type { UserService } from '../../../../src/domain/users/user-service.js';

const user = {
  id: 'user-1',
  email: 'buyer@example.com',
  name: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

function createMockUserService(): UserService {
  return {
    signup: vi.fn(),
    login: vi.fn(),
  } as unknown as UserService;
}

async function buildApp(userService: UserService): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(authRoutes, { userService });
  return app;
}

describe('auth routes', () => {
  let app: FastifyInstance;
  let userService: UserService;

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-secret';
    userService = createMockUserService();
    app = await buildApp(userService);
  });

  afterEach(async () => {
    await app.close();
    delete process.env.JWT_SECRET;
  });

  const validSignupBody = {
    email: 'buyer@example.com',
    password: 'correct-horse-battery',
    passwordConfirm: 'correct-horse-battery',
  };

  describe('POST /auth/signup', () => {
    it('returns 201 with the user and a valid token on success', async () => {
      (userService.signup as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user, token: 'unused' });

      const response = await app.inject({ method: 'POST', url: '/auth/signup', payload: validSignupBody });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({
        user: { id: 'user-1', email: 'buyer@example.com', name: null, createdAt: user.createdAt.toISOString() },
        token: 'unused',
      });
      expect(userService.signup).toHaveBeenCalledWith('buyer@example.com', 'correct-horse-battery');
    });

    it('returns 409 when the email is already registered', async () => {
      (userService.signup as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new EmailAlreadyRegisteredError('buyer@example.com')
      );

      const response = await app.inject({ method: 'POST', url: '/auth/signup', payload: validSignupBody });

      expect(response.statusCode).toBe(409);
    });

    it('returns 400 for an invalid email format without calling the service', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { ...validSignupBody, email: 'not-an-email' },
      });

      expect(response.statusCode).toBe(400);
      expect(userService.signup).not.toHaveBeenCalled();
    });

    it('returns 400 for a password under 8 characters without calling the service', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { ...validSignupBody, password: 'short1', passwordConfirm: 'short1' },
      });

      expect(response.statusCode).toBe(400);
      expect(userService.signup).not.toHaveBeenCalled();
    });

    it('returns 400 when password and passwordConfirm do not match, without calling the service', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { ...validSignupBody, passwordConfirm: 'something-else' },
      });

      expect(response.statusCode).toBe(400);
      expect(userService.signup).not.toHaveBeenCalled();
    });

    it('returns 400 for missing required fields without calling the service', async () => {
      const response = await app.inject({ method: 'POST', url: '/auth/signup', payload: {} });

      expect(response.statusCode).toBe(400);
      expect(userService.signup).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/login', () => {
    it('returns 200 with the user and a valid token on success', async () => {
      (userService.login as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user, token: 'unused' });

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'buyer@example.com', password: 'correct-horse-battery' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().user.id).toBe('user-1');
      expect(userService.login).toHaveBeenCalledWith('buyer@example.com', 'correct-horse-battery');
    });

    it('returns 401 for a wrong password', async () => {
      (userService.login as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new InvalidCredentialsError());

      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'buyer@example.com', password: 'wrong-password' },
      });

      expect(response.statusCode).toBe(401);
      const wrongPasswordBody = response.json();

      (userService.login as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new InvalidCredentialsError());
      const notFoundResponse = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'nobody@example.com', password: 'whatever' },
      });

      // Same status and message for "no such account" as for "wrong
      // password" — the whole point of InvalidCredentialsError is that
      // these must be indistinguishable to the caller.
      expect(notFoundResponse.statusCode).toBe(response.statusCode);
      expect(notFoundResponse.json()).toEqual(wrongPasswordBody);
    });

    it('returns 400 for an invalid email format without calling the service', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'not-an-email', password: 'whatever' },
      });

      expect(response.statusCode).toBe(400);
      expect(userService.login).not.toHaveBeenCalled();
    });

    it('returns 400 for missing fields without calling the service', async () => {
      const response = await app.inject({ method: 'POST', url: '/auth/login', payload: {} });

      expect(response.statusCode).toBe(400);
      expect(userService.login).not.toHaveBeenCalled();
    });
  });
});
