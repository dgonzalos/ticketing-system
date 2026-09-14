import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminAssistantRoutes } from '../../../../../src/api/routes/admin/assistant.js';
import type { AdminAssistantService } from '../../../../../src/domain/ai/admin-assistant.service.js';
import type { IConversationStore } from '../../../../../src/domain/ai/conversation-store.js';
import {
  AiBudgetExceededError,
  ConversationNotFoundError,
  PendingActionExistsError,
} from '../../../../../src/domain/common/errors/domain-errors.js';
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

function createMockAdminAssistantService(): AdminAssistantService {
  return {
    sendMessage: vi.fn(),
    respond: vi.fn(),
  } as unknown as AdminAssistantService;
}

function createMockConversationStore(): IConversationStore {
  return {
    get: vi.fn(),
    save: vi.fn(),
  };
}

/**
 * Mirrors `require-admin.test.ts`'s real `authenticate`/`requireAdmin`
 * decorators (backed by a mock `IUserRepository`), but registers the real
 * `adminAssistantRoutes` plugin instead of a throwaway route — these tests
 * exercise the routes' own body parsing, error mapping, and response shape,
 * not just the auth guards.
 */
async function buildApp(
  adminAssistantService: AdminAssistantService,
  conversationStore: IConversationStore,
  userRepository: IUserRepository
): Promise<FastifyInstance> {
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

  await app.register(adminAssistantRoutes, { adminAssistantService, conversationStore });

  return app;
}

describe('admin assistant routes', () => {
  let app: FastifyInstance;
  let adminAssistantService: AdminAssistantService;
  let conversationStore: IConversationStore;
  let userRepository: IUserRepository;

  beforeEach(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    adminAssistantService = createMockAdminAssistantService();
    conversationStore = createMockConversationStore();
    userRepository = createMockUserRepository();
    (userRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(adminUser());
    (conversationStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    app = await buildApp(adminAssistantService, conversationStore, userRepository);
  });

  afterEach(async () => {
    await app.close();
    delete process.env.JWT_SECRET;
  });

  function authHeader(userId = 'user-1'): { authorization: string } {
    return { authorization: `Bearer ${signToken(userId)}` };
  }

  describe('POST /admin/assistant/messages', () => {
    it('returns 401 with no Authorization header, without calling the service', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/assistant/messages',
        payload: { message: 'hi' },
      });

      expect(response.statusCode).toBe(401);
      expect(adminAssistantService.sendMessage).not.toHaveBeenCalled();
    });

    it('returns 403 for a customer-role token', async () => {
      (userRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(customerUser());

      const response = await app.inject({
        method: 'POST',
        url: '/admin/assistant/messages',
        headers: authHeader(),
        payload: { message: 'hi' },
      });

      expect(response.statusCode).toBe(403);
      expect(adminAssistantService.sendMessage).not.toHaveBeenCalled();
    });

    it('returns 400 for an empty message', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/assistant/messages',
        headers: authHeader(),
        payload: { message: '' },
      });

      expect(response.statusCode).toBe(400);
      expect(adminAssistantService.sendMessage).not.toHaveBeenCalled();
    });

    it('returns 400 for a message over 2000 chars', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/assistant/messages',
        headers: authHeader(),
        payload: { message: 'a'.repeat(2001) },
      });

      expect(response.statusCode).toBe(400);
      expect(adminAssistantService.sendMessage).not.toHaveBeenCalled();
    });

    it('mints a conversationId when none is supplied, calls the service with it, and returns the same value', async () => {
      (adminAssistantService.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce('Hello!');

      const response = await app.inject({
        method: 'POST',
        url: '/admin/assistant/messages',
        headers: authHeader(),
        payload: { message: 'hi' },
      });

      expect(response.statusCode).toBe(200);
      const call = (adminAssistantService.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
      const usedConversationId = call[0] as string;
      expect(typeof usedConversationId).toBe('string');
      expect(usedConversationId.length).toBeGreaterThan(0);
      expect(call[1]).toBe('hi');
      expect(response.json().conversationId).toBe(usedConversationId);
    });

    it('reflects a pendingAction from the conversation store as tool/command/summary only, no toolUseId', async () => {
      (adminAssistantService.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        "I'd like to: Create event \"Hamilton\". Confirm?"
      );
      (conversationStore.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        messages: [],
        pendingAction: { tool: 'create_event', command: { title: 'Hamilton' }, toolUseId: 'tu-1', summary: 'Create event "Hamilton"' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/admin/assistant/messages',
        headers: authHeader(),
        payload: { conversationId: 'conv-1', message: 'create Hamilton' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().pendingAction).toEqual({
        tool: 'create_event',
        command: { title: 'Hamilton' },
        summary: 'Create event "Hamilton"',
      });
    });

    it('returns pendingAction: null when the conversation store has no pending action', async () => {
      (adminAssistantService.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce('There are no events yet.');
      (conversationStore.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ messages: [], pendingAction: null });

      const response = await app.inject({
        method: 'POST',
        url: '/admin/assistant/messages',
        headers: authHeader(),
        payload: { conversationId: 'conv-2', message: 'how many events?' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().pendingAction).toBeNull();
    });

    it('returns pendingAction: null when the conversation store returns null entirely', async () => {
      (adminAssistantService.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce('Hello!');
      (conversationStore.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'POST',
        url: '/admin/assistant/messages',
        headers: authHeader(),
        payload: { message: 'hi' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().pendingAction).toBeNull();
    });

    it('returns 429 with the error message when AiBudgetExceededError is thrown', async () => {
      (adminAssistantService.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new AiBudgetExceededError(5.1, 5)
      );

      const response = await app.inject({
        method: 'POST',
        url: '/admin/assistant/messages',
        headers: authHeader(),
        payload: { message: 'hi' },
      });

      expect(response.statusCode).toBe(429);
      expect(response.json()).toEqual({ error: new AiBudgetExceededError(5.1, 5).message });
    });

    it('returns 409 with the error message when PendingActionExistsError is thrown', async () => {
      (adminAssistantService.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new PendingActionExistsError('conv-3')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/admin/assistant/messages',
        headers: authHeader(),
        payload: { conversationId: 'conv-3', message: 'also cancel perf-2' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: new PendingActionExistsError('conv-3').message });
    });
  });

  describe('POST /admin/assistant/respond', () => {
    it('returns 401 with no Authorization header, without calling the service', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/assistant/respond',
        payload: { conversationId: 'conv-1', decision: 'confirm' },
      });

      expect(response.statusCode).toBe(401);
      expect(adminAssistantService.respond).not.toHaveBeenCalled();
    });

    it('returns 403 for a customer-role token', async () => {
      (userRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(customerUser());

      const response = await app.inject({
        method: 'POST',
        url: '/admin/assistant/respond',
        headers: authHeader(),
        payload: { conversationId: 'conv-1', decision: 'confirm' },
      });

      expect(response.statusCode).toBe(403);
      expect(adminAssistantService.respond).not.toHaveBeenCalled();
    });

    it('returns 400 for a missing decision', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/assistant/respond',
        headers: authHeader(),
        payload: { conversationId: 'conv-1' },
      });

      expect(response.statusCode).toBe(400);
      expect(adminAssistantService.respond).not.toHaveBeenCalled();
    });

    it('passes request.user.userId through as the third argument to adminAssistantService.respond', async () => {
      (adminAssistantService.respond as ReturnType<typeof vi.fn>).mockResolvedValueOnce('Created event "Hamilton" (id e1).');

      const response = await app.inject({
        method: 'POST',
        url: '/admin/assistant/respond',
        headers: authHeader('user-1'),
        payload: { conversationId: 'conv-4', decision: 'confirm' },
      });

      expect(response.statusCode).toBe(200);
      expect(adminAssistantService.respond).toHaveBeenCalledWith('conv-4', 'confirm', 'user-1');
    });

    it('returns 404 with the error message when ConversationNotFoundError is thrown', async () => {
      (adminAssistantService.respond as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new ConversationNotFoundError('never-seen')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/admin/assistant/respond',
        headers: authHeader(),
        payload: { conversationId: 'never-seen', decision: 'confirm' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: new ConversationNotFoundError('never-seen').message });
    });

    it('returns 429 with the error message when AiBudgetExceededError is thrown', async () => {
      (adminAssistantService.respond as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new AiBudgetExceededError(5.1, 5)
      );

      const response = await app.inject({
        method: 'POST',
        url: '/admin/assistant/respond',
        headers: authHeader(),
        payload: { conversationId: 'conv-5', decision: 'confirm' },
      });

      expect(response.statusCode).toBe(429);
      expect(response.json()).toEqual({ error: new AiBudgetExceededError(5.1, 5).message });
    });
  });
});
