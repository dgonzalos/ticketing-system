import { describe, expect, it, vi } from 'vitest';
import { EventNotFoundError } from '../../../../src/domain/common/errors/domain-errors.js';
import { EventCatalog } from '../../../../src/domain/events/event-catalog.js';
import type { Event, IEventRepository, Performance } from '../../../../src/domain/events/event.repository.js';

function createMockRepository(): IEventRepository {
  return {
    listEvents: vi.fn(),
    findEventById: vi.fn(),
    listPerformancesByEvent: vi.fn(),
  };
}

const event: Event = {
  eventId: 'event-1',
  title: 'Hamilton',
  description: 'A musical.',
  imageUrl: null,
};

describe('EventCatalog', () => {
  it('lists every event via the repository', async () => {
    const repository = createMockRepository();
    (repository.listEvents as ReturnType<typeof vi.fn>).mockResolvedValueOnce([event]);
    const catalog = new EventCatalog(repository);

    await expect(catalog.listEvents()).resolves.toEqual([event]);
  });

  it('lists performances for an event sorted by date then time', async () => {
    const repository = createMockRepository();
    (repository.findEventById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(event);
    const later: Performance = {
      performanceId: 'perf-2',
      eventId: 'event-1',
      date: '2026-03-14',
      time: '19:30:00',
      venue: 'Orpheum Theatre',
      city: 'Seattle',
      capacity: 100,
    };
    const earlier: Performance = { ...later, performanceId: 'perf-1', date: '2026-03-14', time: '14:00:00' };
    (repository.listPerformancesByEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce([later, earlier]);
    const catalog = new EventCatalog(repository);

    await expect(catalog.listPerformancesByEvent('event-1')).resolves.toEqual([earlier, later]);
  });

  it('throws EventNotFoundError when the event does not exist', async () => {
    /**
     * The existence check and the listing run concurrently (not gated one
     * behind the other), so `listPerformancesByEvent` is still called even
     * though its result gets discarded once `findEventById` reports null.
     */
    const repository = createMockRepository();
    (repository.findEventById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (repository.listPerformancesByEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const catalog = new EventCatalog(repository);

    const error = await catalog.listPerformancesByEvent('missing-event').catch((e) => e);

    expect(error).toBeInstanceOf(EventNotFoundError);
    expect((error as EventNotFoundError).eventId).toBe('missing-event');
  });
});
