import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z, ZodError } from 'zod';
import type {
  AiAssistantMessageRequestDto,
  AiAssistantRespondRequestDto,
  AiAssistantTurnResponseDto,
} from '@ticketing-system/shared';
import type { AdminAssistantService } from '../../../domain/ai/admin-assistant.service.js';
import type { IConversationStore } from '../../../domain/ai/conversation-store.js';
import {
  AiBudgetExceededError,
  ConversationNotFoundError,
  PendingActionExistsError,
} from '../../../domain/common/errors/domain-errors.js';

export interface AdminAssistantRoutesOptions {
  adminAssistantService: AdminAssistantService;
  /** The SAME instance passed into `adminAssistantService` — not a second one. */
  conversationStore: IConversationStore;
}

interface ErrorResponse {
  error: string;
}

const sendMessageBodySchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().min(1).max(2000), // a cost/abuse guard, not a business rule
});

const respondBodySchema = z.object({
  conversationId: z.string(),
  decision: z.enum(['confirm', 'reject']),
});

/**
 * `AdminAssistantService.sendMessage`/`respond` return the reply text only —
 * the structured `pendingAction` a UI renders as a confirm/reject card lives
 * separately in `IConversationStore`. This reconstructs the one JSON shape
 * the frontend actually needs by reading the same store instance right
 * after the service call returns.
 */
async function buildTurnResponse(
  conversationStore: IConversationStore,
  conversationId: string,
  reply: string
): Promise<AiAssistantTurnResponseDto> {
  const conversation = await conversationStore.get(conversationId);
  const pendingAction = conversation?.pendingAction
    ? { tool: conversation.pendingAction.tool, command: conversation.pendingAction.command, summary: conversation.pendingAction.summary }
    : null;
  return { conversationId, reply, pendingAction };
}

/**
 * HTTP surface for the AI Admin Assistant: an admin sends a natural-language
 * message, and either gets a plain reply or a proposed write action to
 * confirm/reject. Every mutation still goes through the same
 * propose-then-confirm flow `AdminAssistantService` enforces internally —
 * these routes only parse requests and reshape replies, they never call
 * `EventAdminService` directly. Every route requires an authenticated admin.
 */
export const adminAssistantRoutes: FastifyPluginAsync<AdminAssistantRoutesOptions> = async (
  app,
  { adminAssistantService, conversationStore }
) => {
  /**
   * POST /admin/assistant/messages
   *
   * Auth: required, admin only.
   * Body: `{ conversationId?, message }` (see `AiAssistantMessageRequestDto`).
   * When `conversationId` is omitted, this route mints one via `randomUUID()`
   * — `AdminAssistantService.sendMessage` requires a string and never
   * generates one itself.
   * Responses: 200 with `AiAssistantTurnResponseDto`, 400 for a malformed
   * body, 409 if the conversation already has a write action awaiting
   * confirm/reject, 429 if today's AI spend has hit the configured budget.
   */
  app.post<{ Body: AiAssistantMessageRequestDto; Reply: AiAssistantTurnResponseDto | ErrorResponse }>(
    '/admin/assistant/messages',
    { onRequest: [app.authenticate, app.requireAdmin] },
    async (request, reply) => {
      let body;
      try {
        body = sendMessageBodySchema.parse(request.body);
      } catch (err) {
        if (err instanceof ZodError) {
          return reply.code(400).send({ error: 'Invalid request body' });
        }
        throw err;
      }

      const conversationId = body.conversationId ?? randomUUID();

      try {
        const replyText = await adminAssistantService.sendMessage(conversationId, body.message);
        return reply.code(200).send(await buildTurnResponse(conversationStore, conversationId, replyText));
      } catch (err) {
        if (err instanceof AiBudgetExceededError) {
          return reply.code(429).send({ error: err.message });
        }
        if (err instanceof PendingActionExistsError) {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  /**
   * POST /admin/assistant/respond
   *
   * Auth: required, admin only. `adminUserId` for the audit log always comes
   * from `request.user.userId` (the JWT), never from the request body.
   * Body: `{ conversationId, decision }` (see `AiAssistantRespondRequestDto`).
   * Responses: 200 with `AiAssistantTurnResponseDto`, 400 for a malformed
   * body, 404 if there is no pending action for that conversation, 429 if
   * today's AI spend has hit the configured budget.
   */
  app.post<{ Body: AiAssistantRespondRequestDto; Reply: AiAssistantTurnResponseDto | ErrorResponse }>(
    '/admin/assistant/respond',
    { onRequest: [app.authenticate, app.requireAdmin] },
    async (request, reply) => {
      let body;
      try {
        body = respondBodySchema.parse(request.body);
      } catch (err) {
        if (err instanceof ZodError) {
          return reply.code(400).send({ error: 'Invalid request body' });
        }
        throw err;
      }

      try {
        const replyText = await adminAssistantService.respond(body.conversationId, body.decision, request.user.userId);
        return reply.code(200).send(await buildTurnResponse(conversationStore, body.conversationId, replyText));
      } catch (err) {
        if (err instanceof ConversationNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        if (err instanceof AiBudgetExceededError) {
          return reply.code(429).send({ error: err.message });
        }
        throw err;
      }
    }
  );
};
