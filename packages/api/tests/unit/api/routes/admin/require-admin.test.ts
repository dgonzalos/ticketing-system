import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IUserRepository, User } from '../../../../../src/domain/users/user.repository.js';
import { signToken } from '../../../../../src/infrastructure/auth/jwt.js';

const JWT_SECRET = 'test-secret';

function createMockUserRepository(): IUserRepository {
  return {
    create: vi.fn(),
    findByEmail: vi.fn(),
    findById: vi.fn(),
  };
}

function adminUser(): User {
  return { id: 'user-1', email: 'admin@example.com', name: null, createdAt: new Date(), role: 'admin' };
}

function customerUser(): User {
  return { id: 'user-1', email: 'customer@example.com', name: null, createdAt: new Date(), role: 'customer' };
}

/**
 * Bare app exercising just `authenticate` + `requireAdmin`, mirroring the
 * real decorators in `src/index.ts` — a throwaway route stands in for a real
 * admin route, since this test is only about the two guards, not any
 * specific handler's business logic.
 */
async function buildApp(userRepository: IUserRepository): Promise<FastifyInstance> {
  const app = Fastify();

  await app.register(fastifyJwt, {
    secret: JWT_SECRET,
    sign: { algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
  });

  app.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  app.decorate('requireAdmin', async function (request, reply) {
    const user = await userRepository.findById(request.user.userId);
    if (!user || user.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  });

  app.get('/_test-admin', { onRequest: [app.authenticate, app.requireAdmin] }, async () => ({ ok: true }));

  return app;
}

describe('requireAdmin', () => {
  let app: FastifyInstance;
  let userRepository: IUserRepository;

  beforeEach(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    userRepository = createMockUserRepository();
    app = await buildApp(userRepository);
  });

  afterEach(async () => {
    await app.close();
    delete process.env.JWT_SECRET;
  });

  it('replies 401 with no token, without calling findById', async () => {
    const response = await app.inject({ method: 'GET', url: '/_test-admin' });

    expect(response.statusCode).toBe(401);
    expect(userRepository.findById).not.toHaveBeenCalled();
  });

  it('replies 403 for a valid token whose user has role customer', async () => {
    (userRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(customerUser());

    const response = await app.inject({
      method: 'GET',
      url: '/_test-admin',
      headers: { authorization: `Bearer ${signToken('user-1')}` },
    });

    expect(response.statusCode).toBe(403);
  });

  it('runs the handler for a valid token whose user has role admin', async () => {
    (userRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(adminUser());

    const response = await app.inject({
      method: 'GET',
      url: '/_test-admin',
      headers: { authorization: `Bearer ${signToken('user-1')}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('replies 403 for a valid token whose user no longer exists', async () => {
    (userRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'GET',
      url: '/_test-admin',
      headers: { authorization: `Bearer ${signToken('user-1')}` },
    });

    expect(response.statusCode).toBe(403);
  });
});
