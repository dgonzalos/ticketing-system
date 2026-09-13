import type Anthropic from '@anthropic-ai/sdk';
import type { WriteToolName } from './admin-tools.js';

/**
 * A write action the model has proposed and is waiting on a human to
 * confirm or reject. `command` is `unknown` here — it's narrowed by `tool`
 * inside `AdminAssistantService.respond`, which re-parses it through the
 * matching command schema before ever calling `EventAdminService`.
 */
export interface PendingWriteAction {
  tool: WriteToolName;
  command: unknown;
  toolUseId: string;
  summary: string;
}

export interface StoredConversation {
  messages: Anthropic.MessageParam[];
  pendingAction: PendingWriteAction | null;
}

/**
 * Framework-agnostic persistence contract for AI Admin Assistant
 * conversations. `Anthropic` is referenced via `import type` only here —
 * fully erased at compile time, the same type-only convention
 * `packages/shared` already uses — so this interface needs no
 * "framework-free exception" of its own.
 */
export interface IConversationStore {
  get(conversationId: string): Promise<StoredConversation | null>;
  save(conversationId: string, conversation: StoredConversation): Promise<void>;
}
