import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { AdminAssistantService } from '../../../../src/domain/ai/admin-assistant.service.js';
import { AdminToolExecutor } from '../../../../src/domain/ai/admin-tool-executor.js';
import { AiBudgetGuard } from '../../../../src/domain/ai/ai-budget-guard.service.js';
import type { IUsageBudgetRepository } from '../../../../src/domain/ai/usage-budget.repository.js';
import {
  AiBudgetExceededError,
  ConversationNotFoundError,
  EventNotFoundError,
  PendingActionExistsError,
} from '../../../../src/domain/common/errors/domain-errors.js';
import type { EventAdminService } from '../../../../src/domain/events/event-admin.service.js';
import type { EventCatalog } from '../../../../src/domain/events/event-catalog.js';
import type { Event } from '../../../../src/domain/events/event.repository.js';
import { InMemoryConversationStore } from '../../../../src/infrastructure/ai/in-memory-conversation-store.js';

function createMockEventCatalog(): EventCatalog {
  return {
    listEvents: vi.fn(),
    listPerformancesByEvent: vi.fn(),
  } as unknown as EventCatalog;
}

function createMockEventAdminService(): EventAdminService {
  return {
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    createPerformances: vi.fn(),
    cancelPerformance: vi.fn(),
  } as unknown as EventAdminService;
}

function createMockUsageBudgetRepository(): IUsageBudgetRepository {
  return {
    getTodaySpendUsd: vi.fn(),
    recordUsage: vi.fn(),
  };
}

const prices = { inputPricePerMTok: 3, outputPricePerMTok: 15 };

function textBlock(text: string) {
  return { type: 'text', text };
}

function toolUseBlock(id: string, name: string, input: unknown) {
  return { type: 'tool_use', id, name, input };
}

function fakeMessage(content: unknown[]) {
  return {
    content,
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: null, cache_read_input_tokens: null },
  };
}

function buildService(dailyBudgetUsd = 1) {
  const anthropic = { messages: { create: vi.fn() } };
  const eventCatalog = createMockEventCatalog();
  const eventAdminService = createMockEventAdminService();
  const usageRepository = createMockUsageBudgetRepository();
  vi.mocked(usageRepository.getTodaySpendUsd).mockResolvedValue(0);
  const budgetGuard = new AiBudgetGuard(usageRepository, dailyBudgetUsd, prices);
  const toolExecutor = new AdminToolExecutor(eventCatalog);
  const conversationStore = new InMemoryConversationStore();

  const service = new AdminAssistantService(
    anthropic as unknown as Anthropic,
    'claude-haiku-4-5',
    toolExecutor,
    conversationStore,
    eventAdminService,
    budgetGuard
  );

  return { service, anthropic, eventCatalog, eventAdminService, usageRepository, conversationStore };
}

const event: Event = { eventId: 'e1', title: 'Hamilton', description: null, imageUrl: null };

describe('AdminAssistantService', () => {
  it('returns the final text reply when the model makes no tool call', async () => {
    const { service, anthropic } = buildService();
    vi.mocked(anthropic.messages.create).mockResolvedValueOnce(fakeMessage([textBlock('Hello, how can I help?')]));

    const reply = await service.sendMessage('conv-1', 'hi');

    expect(reply).toBe('Hello, how can I help?');
    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
  });

  it('executes a read tool call and continues the loop to a final reply', async () => {
    const { service, anthropic, eventCatalog } = buildService();
    vi.mocked(eventCatalog.listEvents).mockResolvedValue([event]);
    vi.mocked(anthropic.messages.create)
      .mockResolvedValueOnce(fakeMessage([toolUseBlock('tu-1', 'list_events', {})]))
      .mockResolvedValueOnce(fakeMessage([textBlock('There is one event: Hamilton.')]));

    const reply = await service.sendMessage('conv-2', 'what events are there?');

    expect(reply).toBe('There is one event: Hamilton.');
    expect(anthropic.messages.create).toHaveBeenCalledTimes(2);
  });

  it('stops immediately on a write tool call, storing a pending action and never calling EventAdminService', async () => {
    const { service, anthropic, eventAdminService, conversationStore } = buildService();
    vi.mocked(anthropic.messages.create).mockResolvedValueOnce(
      fakeMessage([toolUseBlock('tu-2', 'create_event', { title: 'Hamilton' })])
    );

    const reply = await service.sendMessage('conv-3', 'create an event called Hamilton');

    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
    expect(eventAdminService.createEvent).not.toHaveBeenCalled();
    expect(reply).toContain('Hamilton');
    const stored = await conversationStore.get('conv-3');
    expect(stored?.pendingAction?.tool).toBe('create_event');
    expect(stored?.pendingAction?.command).toEqual({ title: 'Hamilton' });
  });

  it('respond("confirm") calls the matching EventAdminService method with the exact command and makes no further Anthropic call', async () => {
    const { service, anthropic, eventAdminService, conversationStore } = buildService();
    vi.mocked(anthropic.messages.create).mockResolvedValueOnce(
      fakeMessage([toolUseBlock('tu-3', 'create_event', { title: 'Hamilton' })])
    );
    await service.sendMessage('conv-4', 'create an event called Hamilton');
    vi.mocked(eventAdminService.createEvent).mockResolvedValue(event);

    const reply = await service.respond('conv-4', 'confirm');

    expect(eventAdminService.createEvent).toHaveBeenCalledTimes(1);
    expect(eventAdminService.createEvent).toHaveBeenCalledWith({ title: 'Hamilton' });
    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
    expect(reply).toContain('Hamilton');
    const stored = await conversationStore.get('conv-4');
    expect(stored?.pendingAction).toBeNull();
  });

  it('respond("confirm") turns a known domain error into a clean reply instead of throwing', async () => {
    const { service, anthropic, eventAdminService } = buildService();
    vi.mocked(anthropic.messages.create).mockResolvedValueOnce(
      fakeMessage([toolUseBlock('tu-4', 'update_event', { eventId: 'missing', title: 'New Title' })])
    );
    await service.sendMessage('conv-5', 'rename event missing to New Title');
    vi.mocked(eventAdminService.updateEvent).mockRejectedValue(new EventNotFoundError('missing'));

    const reply = await service.respond('conv-5', 'confirm');

    expect(reply).toContain("couldn't find that event");
  });

  it('respond("reject") cancels without calling EventAdminService or Anthropic again', async () => {
    const { service, anthropic, eventAdminService } = buildService();
    vi.mocked(anthropic.messages.create).mockResolvedValueOnce(
      fakeMessage([toolUseBlock('tu-5', 'cancel_performance', { performanceId: 'perf-1' })])
    );
    await service.sendMessage('conv-6', 'cancel perf-1');

    const reply = await service.respond('conv-6', 'reject');

    expect(eventAdminService.cancelPerformance).not.toHaveBeenCalled();
    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
    expect(reply).toBe('Okay, I will not make that change.');
  });

  it('respond throws ConversationNotFoundError when there is no pending action', async () => {
    const { service } = buildService();

    await expect(service.respond('never-seen', 'confirm')).rejects.toBeInstanceOf(ConversationNotFoundError);
  });

  it('throws AiBudgetExceededError and never calls Anthropic when already over budget', async () => {
    const { service, anthropic, usageRepository } = buildService();
    vi.mocked(usageRepository.getTodaySpendUsd).mockResolvedValue(999);

    await expect(service.sendMessage('conv-7', 'hi')).rejects.toBeInstanceOf(AiBudgetExceededError);
    expect(anthropic.messages.create).not.toHaveBeenCalled();
  });

  it('stops after MAX_TOOL_ITERATIONS (4) with an explanatory reply instead of looping forever', async () => {
    const { service, anthropic, eventCatalog } = buildService();
    vi.mocked(eventCatalog.listEvents).mockResolvedValue([]);
    vi.mocked(anthropic.messages.create).mockResolvedValue(fakeMessage([toolUseBlock('tu-x', 'list_events', {})]));

    const reply = await service.sendMessage('conv-8', 'loop forever');

    expect(anthropic.messages.create).toHaveBeenCalledTimes(4);
    expect(reply).toMatch(/allotted number of steps/);
  });

  it('serializes concurrent sendMessage calls on the same conversationId so the pending-action check cannot race', async () => {
    const { service, anthropic } = buildService();
    let resolveFirstCreate: () => void = () => {};
    const firstCreateGate = new Promise<void>((resolve) => {
      resolveFirstCreate = resolve;
    });

    vi.mocked(anthropic.messages.create).mockImplementationOnce(async () => {
      await firstCreateGate;
      return fakeMessage([toolUseBlock('tu-race', 'cancel_performance', { performanceId: 'perf-1' })]);
    });

    // Issued back-to-back, no await in between — the second call's lock
    // check must still see the first call's in-flight state, not race it.
    const firstCall = service.sendMessage('conv-race', 'cancel perf-1');
    const secondCall = service.sendMessage('conv-race', 'also cancel perf-2');

    resolveFirstCreate();

    const [firstResult, secondResult] = await Promise.allSettled([firstCall, secondCall]);

    expect(firstResult.status).toBe('fulfilled');
    expect(secondResult.status).toBe('rejected');
    if (secondResult.status === 'rejected') {
      expect(secondResult.reason).toBeInstanceOf(PendingActionExistsError);
    }
  });

  it('sendMessage throws PendingActionExistsError when a write proposal is already pending, without calling Anthropic again', async () => {
    const { service, anthropic } = buildService();
    vi.mocked(anthropic.messages.create).mockResolvedValueOnce(
      fakeMessage([toolUseBlock('tu-6', 'cancel_performance', { performanceId: 'perf-1' })])
    );
    await service.sendMessage('conv-9', 'cancel perf-1');

    await expect(service.sendMessage('conv-9', 'actually, list events instead')).rejects.toBeInstanceOf(
      PendingActionExistsError
    );
    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent respond("confirm") calls on the same pending action so EventAdminService is called exactly once', async () => {
    const { service, anthropic, eventAdminService } = buildService();
    vi.mocked(anthropic.messages.create).mockResolvedValueOnce(
      fakeMessage([toolUseBlock('tu-confirm-race', 'create_event', { title: 'Hamilton' })])
    );
    await service.sendMessage('conv-confirm-race', 'create an event called Hamilton');

    let resolveCreateEvent: () => void = () => {};
    const createEventGate = new Promise<void>((resolve) => {
      resolveCreateEvent = resolve;
    });
    vi.mocked(eventAdminService.createEvent).mockImplementationOnce(async () => {
      await createEventGate;
      return event;
    });

    // Issued back-to-back, no await in between — a double-clicked "Confirm"
    // button is exactly this shape, and it's the race the lock exists for:
    // without it, both calls could read the same pendingAction before
    // either clears it and both call createEvent.
    const firstCall = service.respond('conv-confirm-race', 'confirm');
    const secondCall = service.respond('conv-confirm-race', 'confirm');

    resolveCreateEvent();

    const [firstResult, secondResult] = await Promise.allSettled([firstCall, secondCall]);

    expect(eventAdminService.createEvent).toHaveBeenCalledTimes(1);
    expect(firstResult.status).toBe('fulfilled');
    expect(secondResult.status).toBe('rejected');
    if (secondResult.status === 'rejected') {
      expect(secondResult.reason).toBeInstanceOf(ConversationNotFoundError);
    }
  });

  it('gives every extra write tool_use block in one turn an error tool_result instead of silently dropping it', async () => {
    const { service, anthropic, conversationStore } = buildService();
    vi.mocked(anthropic.messages.create).mockResolvedValueOnce(
      fakeMessage([
        toolUseBlock('tu-write-1', 'create_event', { title: 'Hamilton' }),
        toolUseBlock('tu-write-2', 'cancel_performance', { performanceId: 'perf-1' }),
      ])
    );

    const reply = await service.sendMessage('conv-10', 'create Hamilton and cancel perf-1');

    expect(reply).toContain('Hamilton');
    const stored = await conversationStore.get('conv-10');
    expect(stored?.pendingAction?.tool).toBe('create_event');
    const lastMessage = stored?.messages[stored.messages.length - 1];
    expect(lastMessage?.role).toBe('user');
    const blocks = lastMessage?.content as Anthropic.ToolResultBlockParam[];
    const extraResult = blocks.find((block) => block.tool_use_id === 'tu-write-2');
    expect(extraResult).toMatchObject({ type: 'tool_result', is_error: true });
  });
});
