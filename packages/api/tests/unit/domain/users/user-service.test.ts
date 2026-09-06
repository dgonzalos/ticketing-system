import argon2 from 'argon2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidCredentialsError } from '../../../../src/domain/common/errors/domain-errors.js';
import { UserService } from '../../../../src/domain/users/user-service.js';
import type { IUserRepository, User } from '../../../../src/domain/users/user.repository.js';
import { jwtTokenSigner, verifyToken } from '../../../../src/infrastructure/auth/jwt.js';

function createMockUserRepository(): IUserRepository {
  return {
    create: vi.fn(),
    findByEmail: vi.fn(),
    findById: vi.fn(),
  };
}

const user: User = {
  id: 'user-1',
  email: 'buyer@example.com',
  name: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('UserService', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  describe('signup', () => {
    it('hashes the password with Argon2, creates the user, and returns a valid token', async () => {
      const userRepository = createMockUserRepository();
      (userRepository.create as ReturnType<typeof vi.fn>).mockImplementationOnce(async (email: string) => ({
        ...user,
        email,
      }));
      const service = new UserService(userRepository, jwtTokenSigner);

      const result = await service.signup('Buyer@Example.com', 'correct-horse-battery');

      // Normalizes to lowercase before storing.
      expect(userRepository.create).toHaveBeenCalledWith('buyer@example.com', expect.stringMatching(/^\$argon2/));
      expect(result.user).toEqual({ ...user, email: 'buyer@example.com' });
      expect(verifyToken(result.token)).toEqual({ userId: 'user-1' });
    });

    it('never stores the plaintext password', async () => {
      const userRepository = createMockUserRepository();
      (userRepository.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce(user);
      const service = new UserService(userRepository, jwtTokenSigner);

      await service.signup('buyer@example.com', 'correct-horse-battery');

      const [, passwordHash] = (userRepository.create as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(passwordHash).not.toBe('correct-horse-battery');
      expect(passwordHash.length).toBeGreaterThan(20);
    });

    it('propagates EmailAlreadyRegisteredError from the repository', async () => {
      const userRepository = createMockUserRepository();
      const repositoryError = new Error('duplicate email');
      (userRepository.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(repositoryError);
      const service = new UserService(userRepository, jwtTokenSigner);

      await expect(service.signup('buyer@example.com', 'correct-horse-battery')).rejects.toBe(repositoryError);
    });
  });

  describe('login', () => {
    it('verifies the password and returns a valid token on success', async () => {
      const userRepository = createMockUserRepository();
      const passwordHash = await argon2.hash('correct-horse-battery');
      (userRepository.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ...user, passwordHash });
      const service = new UserService(userRepository, jwtTokenSigner);

      const result = await service.login('Buyer@Example.com', 'correct-horse-battery');

      expect(userRepository.findByEmail).toHaveBeenCalledWith('buyer@example.com');
      expect(result.user).toEqual(user);
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(verifyToken(result.token)).toEqual({ userId: 'user-1' });
    });

    it('throws InvalidCredentialsError for a wrong password', async () => {
      const userRepository = createMockUserRepository();
      const passwordHash = await argon2.hash('correct-horse-battery');
      (userRepository.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ...user, passwordHash });
      const service = new UserService(userRepository, jwtTokenSigner);

      await expect(service.login('buyer@example.com', 'wrong-password')).rejects.toBeInstanceOf(
        InvalidCredentialsError
      );
    });

    it('throws the same InvalidCredentialsError for an unknown email', async () => {
      const userRepository = createMockUserRepository();
      (userRepository.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      const service = new UserService(userRepository, jwtTokenSigner);

      await expect(service.login('nobody@example.com', 'whatever')).rejects.toBeInstanceOf(InvalidCredentialsError);
    });
  });
});
