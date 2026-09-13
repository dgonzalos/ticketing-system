import { describe, expect, it, vi } from 'vitest';
import { AdminToolExecutor } from '../../../../src/domain/ai/admin-tool-executor.js';
import { EventNotFoundError } from '../../../../src/domain/common/errors/domain-errors.js';
import type { Event, Performance } from '../../../../src/domain/events/event.repository.js';
import type { EventCatalog } from '../../../../src/domain/events/event-catalog.js';

function createMockEventCatalog(): EventCatalog {
  return {
    listEvents: vi.fn(),
    listPerformancesByEvent: vi.fn(),
  } as unknown as EventCatalog;
}

const event: Event = { eventId: 'event-1', title: 'Hamilton', description: null, imageUrl: null };

const performance: Performance = {
  performanceId: 'perf-1',
  eventId: 'event-1',
  date: '2026-10-02',
  time: '20:00:00',
  venue: 'Orpheum Theatre',
  city: 'Seattle',
  capacity: 100,
  status: 'scheduled',
};

describe('AdminToolExecutor', () => {
  describe('read tools', () => {
    it('executes list_events and returns the catalog result', async () => {
      const catalog = createMockEventCatalog();
      vi.mocked(catalog.listEvents).mockResolvedValue([event]);
      const executor = new AdminToolExecutor(catalog);

      const outcome = await executor.execute('list_events', {});

      expect(outcome).toEqual({ kind: 'executed', result: [event] });
    });

    it('executes list_performances and returns the catalog result', async () => {
      const catalog = createMockEventCatalog();
      vi.mocked(catalog.listPerformancesByEvent).mockResolvedValue([performance]);
      const executor = new AdminToolExecutor(catalog);

      const outcome = await executor.execute('list_performances', { eventId: 'event-1' });

      expect(catalog.listPerformancesByEvent).toHaveBeenCalledWith('event-1');
      expect(outcome).toEqual({ kind: 'executed', result: [performance] });
    });

    it('returns invalid, not a thrown exception, when list_performances is given a nonexistent eventId', async () => {
      const catalog = createMockEventCatalog();
      vi.mocked(catalog.listPerformancesByEvent).mockRejectedValue(new EventNotFoundError('missing-event'));
      const executor = new AdminToolExecutor(catalog);

      const outcome = await executor.execute('list_performances', { eventId: 'missing-event' });

      expect(outcome.kind).toBe('invalid');
    });

    it('returns invalid on malformed input without calling the catalog', async () => {
      const catalog = createMockEventCatalog();
      const executor = new AdminToolExecutor(catalog);

      const outcome = await executor.execute('list_performances', {});

      expect(outcome.kind).toBe('invalid');
      expect(catalog.listPerformancesByEvent).not.toHaveBeenCalled();
    });
  });

  describe('write tools', () => {
    it('returns pending with the parsed command for a valid create_event call, touching nothing else', async () => {
      const catalog = createMockEventCatalog();
      const executor = new AdminToolExecutor(catalog);

      const outcome = await executor.execute('create_event', { title: 'Hamilton' });

      expect(outcome).toEqual({
        kind: 'pending',
        tool: 'create_event',
        command: { title: 'Hamilton' },
        summary: expect.stringContaining('Hamilton'),
      });
      expect(catalog.listEvents).not.toHaveBeenCalled();
      expect(catalog.listPerformancesByEvent).not.toHaveBeenCalled();
    });

    it('returns invalid for create_event missing a required title', async () => {
      const catalog = createMockEventCatalog();
      const executor = new AdminToolExecutor(catalog);

      const outcome = await executor.execute('create_event', {});

      expect(outcome.kind).toBe('invalid');
    });

    it('returns invalid for create_performances with a malformed date', async () => {
      const catalog = createMockEventCatalog();
      const executor = new AdminToolExecutor(catalog);

      const outcome = await executor.execute('create_performances', {
        eventId: 'event-1',
        performances: [{ date: 'not-a-date', time: '19:30:00', venue: 'Orpheum', city: 'Seattle' }],
      });

      expect(outcome.kind).toBe('invalid');
    });

    it('returns pending for a valid cancel_performance call', async () => {
      const catalog = createMockEventCatalog();
      const executor = new AdminToolExecutor(catalog);

      const outcome = await executor.execute('cancel_performance', { performanceId: 'perf-1' });

      expect(outcome).toEqual({
        kind: 'pending',
        tool: 'cancel_performance',
        command: { performanceId: 'perf-1' },
        summary: expect.stringContaining('perf-1'),
      });
    });
  });

  it('returns invalid for an unknown tool name', async () => {
    const catalog = createMockEventCatalog();
    const executor = new AdminToolExecutor(catalog);

    const outcome = await executor.execute('delete_event', {});

    expect(outcome).toEqual({ kind: 'invalid', message: 'Unknown tool: delete_event' });
  });
});
