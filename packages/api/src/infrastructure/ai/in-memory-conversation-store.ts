import type { IConversationStore, StoredConversation } from '../../domain/ai/conversation-store.js';

/**
 * `IConversationStore` backed by a plain in-process `Map`. This is a named,
 * deliberate scope limit for the current phase, not an oversight:
 * conversation state lives only in this process's memory, so it is lost on
 * every server restart and shares nothing across multiple API instances —
 * acceptable for a single dev/staging instance, but this needs a real
 * persisted store (e.g. a `conversations` table) before any multi-instance
 * deployment. A Postgres-backed implementation of the same interface is a
 * drop-in swap later — nothing above this layer (`AdminAssistantService`)
 * needs to change for that.
 */
export class InMemoryConversationStore implements IConversationStore {
  private readonly conversations = new Map<string, StoredConversation>();

  async get(conversationId: string): Promise<StoredConversation | null> {
    return this.conversations.get(conversationId) ?? null;
  }

  async save(conversationId: string, conversation: StoredConversation): Promise<void> {
    this.conversations.set(conversationId, conversation);
  }
}
