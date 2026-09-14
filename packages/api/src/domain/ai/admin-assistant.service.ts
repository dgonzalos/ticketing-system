import type Anthropic from '@anthropic-ai/sdk';
import {
  ConversationNotFoundError,
  EventNotFoundError,
  PendingActionExistsError,
  PerformanceAlreadyScheduledError,
  PerformanceHasSalesError,
  PerformanceNotFoundError,
} from '../common/errors/domain-errors.js';
import {
  CancelPerformanceCommandSchema,
  CreateEventCommandSchema,
  CreatePerformancesCommandSchema,
  UpdateEventCommandSchema,
} from '../events/catalog-commands.js';
import type { EventAdminService } from '../events/event-admin.service.js';
import type { AdminToolExecutor } from './admin-tool-executor.js';
import { buildToolDefinitions, isReadToolName, isWriteToolName } from './admin-tools.js';
import type { AiBudgetGuard } from './ai-budget-guard.service.js';
import type { IConversationStore, PendingWriteAction } from './conversation-store.js';
import type { AnthropicUsage } from './pricing.js';

const MAX_TOOL_ITERATIONS = 4; // each iteration is a full billed call — keep this tight
const MAX_STORED_MESSAGES = 20; // sliding window, oldest dropped first — bounds input-token growth per call
const MAX_OUTPUT_TOKENS = 400; // output tokens cost several times what input tokens do; replies are short by nature

type DomainFailure = EventNotFoundError | PerformanceNotFoundError | PerformanceAlreadyScheduledError | PerformanceHasSalesError;

function isDomainFailure(error: unknown): error is DomainFailure {
  return (
    error instanceof EventNotFoundError ||
    error instanceof PerformanceNotFoundError ||
    error instanceof PerformanceAlreadyScheduledError ||
    error instanceof PerformanceHasSalesError
  );
}

function describeDomainFailure(error: DomainFailure): string {
  if (error instanceof EventNotFoundError) {
    return "I couldn't find that event — it may have been removed. Nothing was changed.";
  }
  if (error instanceof PerformanceNotFoundError) {
    return "I couldn't find that performance — it may have been removed. Nothing was changed.";
  }
  if (error instanceof PerformanceAlreadyScheduledError) {
    return 'A performance already exists for that event/date/time/venue. Nothing was changed.';
  }
  return "That performance already has sold seats and can't be cancelled. Nothing was changed.";
}

/**
 * Maps the SDK's real response `Usage` (nullable cache-token fields) onto
 * this codebase's `AnthropicUsage` (optional cache-token fields, shipped in
 * Phase 1's `pricing.ts`) — the one seam where that mismatch needs
 * reconciling, since `null` isn't assignable to `undefined`.
 */
function adaptUsage(usage: Anthropic.Usage): AnthropicUsage {
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? undefined,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? undefined,
  };
}

function buildSystemPrompt(): Anthropic.TextBlockParam[] {
  const today = new Date().toISOString().slice(0, 10);
  const text = [
    `Today's date is ${today} (UTC).`,
    'You are an admin assistant for a ticketing system, helping schedule events and performances through natural language.',
    'Never invent or accept a user-stated eventId or performanceId at face value — resolve names to ids yourself via list_events/list_performances first.',
    'Calling a write tool only proposes an action; nothing is applied until a human confirms it outside this conversation, so never tell the user an action is done right after proposing it.',
    'If the request is ambiguous or missing required information, ask a clarifying question instead of guessing.',
  ].join(' ');

  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}

/**
 * Clones `messages` and adds an ephemeral cache breakpoint to the last
 * content block of the last message — the correct multi-turn caching
 * placement for an append-only conversation, since the last message is
 * always the newest thing added since the previous call. Never mutates the
 * stored array — the persisted `StoredConversation.messages` stays free of
 * these annotations, since the breakpoint deliberately moves every call.
 */
function withCacheControlOnLastMessage(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length === 0) {
    return messages;
  }
  const clone = [...messages];
  const last = clone[clone.length - 1];
  const blocks: Anthropic.ContentBlockParam[] = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : [...last.content];
  if (blocks.length === 0) {
    return clone;
  }
  const lastIndex = blocks.length - 1;
  blocks[lastIndex] = { ...blocks[lastIndex], cache_control: { type: 'ephemeral' } } as Anthropic.ContentBlockParam;
  clone[clone.length - 1] = { ...last, content: blocks };
  return clone;
}

function isFreshUserTurn(message: Anthropic.MessageParam): boolean {
  if (message.role !== 'user') {
    return false;
  }
  if (typeof message.content === 'string') {
    return true;
  }
  return !message.content.some((block) => block.type === 'tool_result');
}

/**
 * Trims to the last `MAX_STORED_MESSAGES` entries, but never mid tool_use/
 * tool_result pair — a naive `slice(-N)` can leave a dangling tool_result
 * with no matching tool_use (or vice versa), which the API rejects. Finds
 * the nearest "fresh user turn" at or after the trim boundary; if none
 * exists within budget, keeps everything rather than corrupt the transcript.
 */
function trimMessages(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length <= MAX_STORED_MESSAGES) {
    return messages;
  }
  const minStart = messages.length - MAX_STORED_MESSAGES;
  for (let start = minStart; start < messages.length; start++) {
    if (isFreshUserTurn(messages[start])) {
      return messages.slice(start);
    }
  }
  return messages;
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function toAssistantMessage(response: Anthropic.Message): Anthropic.MessageParam {
  return { role: 'assistant', content: response.content };
}

function toToolResultBlock(toolUseId: string, content: string, isError = false): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError };
}

/**
 * The AI Admin Assistant's conversation loop. Given a natural-language
 * message, resolves names to ids via read-only tools and proposes a
 * structured write command via `AdminToolExecutor` — never executing a
 * mutation itself. Only `respond('confirm')` ever calls `EventAdminService`,
 * and it's a human-triggered call (wired to a route in a later phase), not
 * something the model can reach on its own.
 */
export class AdminAssistantService {
  private readonly toolDefinitions: Anthropic.Tool[];

  /**
   * Serializes `sendMessage`/`respond` calls per `conversationId` — both
   * methods do a check-then-act read of `pendingAction` before writing, and
   * without this, two concurrent calls on the same conversation (a
   * double-clicked "Confirm" button, a client retry) can both pass their
   * check before either saves, silently overwriting one proposal with
   * another or letting a confirm execute a different action than the one
   * the caller was actually shown. Calls for *different* conversationIds
   * are unaffected and run fully concurrently. This is an in-process lock,
   * matching `InMemoryConversationStore`'s own already-documented
   * single-instance scope — a future multi-instance deployment would need
   * this moved into the store itself (e.g. compare-and-swap on save), not
   * just here.
   *
   * Self-cleaning: `withConversationLock` deletes a conversationId's entry
   * once its chain settles and no newer call has replaced it, so this map's
   * size tracks conversations with an in-flight or queued call, not every
   * conversationId ever seen — it does not grow unbounded over the life of
   * the process.
   */
  private readonly conversationLocks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly anthropic: Anthropic,
    private readonly model: string,
    private readonly toolExecutor: AdminToolExecutor,
    private readonly conversationStore: IConversationStore,
    private readonly eventAdminService: EventAdminService, // used ONLY inside respond('confirm')
    private readonly budgetGuard: AiBudgetGuard
  ) {
    this.toolDefinitions = buildToolDefinitions();
  }

  private async withConversationLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.conversationLocks.get(conversationId) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    // Chain on a version that always resolves, so one failed call doesn't
    // permanently jam the queue for this conversationId — the real
    // success/failure of `run` still propagates to this call's own caller.
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    this.conversationLocks.set(conversationId, tail);
    // Once this call's link in the chain settles, drop the entry — but only
    // if nothing newer has chained onto it since. If the map still points at
    // this exact `tail`, no other call is queued behind it, so it's safe to
    // forget this conversationId until the next call recreates the entry.
    void tail.then(() => {
      if (this.conversationLocks.get(conversationId) === tail) {
        this.conversationLocks.delete(conversationId);
      }
    });
    return run;
  }

  /** @throws {PendingActionExistsError} if the conversation already has a write action awaiting confirm/reject. */
  async sendMessage(conversationId: string, userMessage: string): Promise<string> {
    return this.withConversationLock(conversationId, () => this.sendMessageLocked(conversationId, userMessage));
  }

  private async sendMessageLocked(conversationId: string, userMessage: string): Promise<string> {
    const existing = await this.conversationStore.get(conversationId);
    if (existing?.pendingAction) {
      throw new PendingActionExistsError(conversationId);
    }
    const messages: Anthropic.MessageParam[] = [...(existing?.messages ?? []), { role: 'user', content: userMessage }];
    return this.runLoop(conversationId, messages);
  }

  async respond(conversationId: string, decision: 'confirm' | 'reject'): Promise<string> {
    return this.withConversationLock(conversationId, () => this.respondLocked(conversationId, decision));
  }

  private async respondLocked(conversationId: string, decision: 'confirm' | 'reject'): Promise<string> {
    const conversation = await this.conversationStore.get(conversationId);
    if (!conversation || !conversation.pendingAction) {
      throw new ConversationNotFoundError(conversationId);
    }
    const { pendingAction } = conversation;

    if (decision === 'reject') {
      const replyText = 'Okay, I will not make that change.';
      const messages = trimMessages([
        ...conversation.messages,
        { role: 'user', content: [toToolResultBlock(pendingAction.toolUseId, 'Rejected by admin — not executed.')] },
      ]);
      await this.conversationStore.save(conversationId, { messages, pendingAction: null });
      return replyText;
    }

    let replyText: string;
    let isError = false;
    try {
      replyText = await this.executeConfirmedAction(pendingAction);
    } catch (error) {
      if (!isDomainFailure(error)) {
        throw error;
      }
      replyText = describeDomainFailure(error);
      isError = true;
    }

    const messages = trimMessages([
      ...conversation.messages,
      { role: 'user', content: [toToolResultBlock(pendingAction.toolUseId, replyText, isError)] },
    ]);
    await this.conversationStore.save(conversationId, { messages, pendingAction: null });
    return replyText;
  }

  private async executeConfirmedAction(pendingAction: PendingWriteAction): Promise<string> {
    switch (pendingAction.tool) {
      case 'create_event': {
        const command = CreateEventCommandSchema.parse(pendingAction.command);
        const event = await this.eventAdminService.createEvent(command);
        return `Created event "${event.title}" (id ${event.eventId}).`;
      }
      case 'update_event': {
        const command = UpdateEventCommandSchema.parse(pendingAction.command);
        const event = await this.eventAdminService.updateEvent(command);
        return `Updated event "${event.title}" (id ${event.eventId}).`;
      }
      case 'create_performances': {
        const command = CreatePerformancesCommandSchema.parse(pendingAction.command);
        const performances = await this.eventAdminService.createPerformances(command);
        return `Scheduled ${performances.length} performance(s) for event ${command.eventId}.`;
      }
      case 'cancel_performance': {
        const command = CancelPerformanceCommandSchema.parse(pendingAction.command);
        await this.eventAdminService.cancelPerformance(command);
        return `Cancelled performance ${command.performanceId}.`;
      }
    }
  }

  private async runLoop(conversationId: string, messages: Anthropic.MessageParam[]): Promise<string> {
    let working = trimMessages(messages);

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const response = await this.budgetGuard.run(async () => {
        const message = await this.anthropic.messages.create({
          model: this.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: buildSystemPrompt(),
          tools: this.toolDefinitions,
          messages: withCacheControlOnLastMessage(working),
        });
        return { result: message, usage: adaptUsage(message.usage) };
      });

      const toolUseBlocks = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');

      if (toolUseBlocks.length === 0) {
        const finalText = extractText(response.content);
        working = trimMessages([...working, toAssistantMessage(response)]);
        await this.conversationStore.save(conversationId, { messages: working, pendingAction: null });
        return finalText;
      }

      working = [...working, toAssistantMessage(response)];

      const writeBlock = toolUseBlocks.find((block) => isWriteToolName(block.name));
      const readBlocks = toolUseBlocks.filter((block) => isReadToolName(block.name));
      const extraBlocks = toolUseBlocks.filter((block) => block !== writeBlock && !readBlocks.includes(block));

      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];

      // Every tool_use the model emits must get a tool_result — even a
      // discarded one — or the next call on this conversation is rejected as
      // malformed. Only one write proposal is honored per turn; any further
      // write calls in the same response are told so, not silently dropped.
      for (const extra of extraBlocks) {
        console.warn(`AdminAssistantService: discarding extra tool_use ${extra.name} (${extra.id})`);
        toolResultBlocks.push(
          toToolResultBlock(
            extra.id,
            'Only one write action can be proposed per turn; this one was ignored. Ask again separately if it is still needed.',
            true
          )
        );
      }

      for (const block of readBlocks) {
        const outcome = await this.toolExecutor.execute(block.name, block.input);
        if (outcome.kind === 'invalid') {
          toolResultBlocks.push(toToolResultBlock(block.id, outcome.message, true));
        } else if (outcome.kind === 'executed') {
          toolResultBlocks.push(toToolResultBlock(block.id, JSON.stringify(outcome.result)));
        } else {
          // A read tool should never produce 'pending' — defensive fallback, not expected in practice.
          toolResultBlocks.push(toToolResultBlock(block.id, 'Unexpected pending outcome for a read tool', true));
        }
      }

      if (writeBlock) {
        const outcome = await this.toolExecutor.execute(writeBlock.name, writeBlock.input);
        if (outcome.kind === 'pending') {
          const nextMessages =
            toolResultBlocks.length > 0 ? [...working, { role: 'user' as const, content: toolResultBlocks }] : working;
          working = trimMessages(nextMessages);
          await this.conversationStore.save(conversationId, {
            messages: working,
            pendingAction: { tool: outcome.tool, command: outcome.command, toolUseId: writeBlock.id, summary: outcome.summary },
          });
          return `I'd like to: ${outcome.summary}. Confirm?`;
        }
        const message = outcome.kind === 'invalid' ? outcome.message : 'Unexpected executed outcome for a write tool';
        toolResultBlocks.push(toToolResultBlock(writeBlock.id, message, true));
      }

      working = trimMessages([...working, { role: 'user', content: toolResultBlocks }]);
    }

    const reply = "I wasn't able to finish that within the allotted number of steps — could you rephrase or simplify your request?";
    await this.conversationStore.save(conversationId, { messages: working, pendingAction: null });
    return reply;
  }
}
