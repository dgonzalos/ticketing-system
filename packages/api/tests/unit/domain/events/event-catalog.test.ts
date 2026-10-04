import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventNotFoundError } from '../../../../src/domain/common/errors/domain-errors.js';
import { EventCatalog } from '../../../../src/domain/events/event-catalog.js';
import type { Event, IEventRepository, Performance, PerformanceSummary } from '../../../../src/domain/events/event.repository.js';

function createMockRepository(): IEventRepository {
  return {
    listEvents: vi.fn(),
    findEventById: vi.fn(),
    listPerformancesByEvent: vi.fn(),
    listAllPerformancesByEvent: vi.fn(),
    findPerformanceById: vi.fn(),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    createPerformances: vi.fn(),
    findScheduledPerformance: vi.fn(),
    cancelPerformance: vi.fn(),
    listEventSummaries: vi.fn(),
    listPerformanceSummariesByEvent: vi.fn(),
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
      status: 'scheduled',
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

  describe('public summaries', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const summary = (overrides: Partial<PerformanceSummary>): PerformanceSummary => ({
      performanceId: 'perf-1',
      eventId: 'event-1',
      date: '2026-10-16',
      time: '19:30:00',
      venue: 'Teatro Alameda',
      city: 'Madrid',
      capacity: 100,
      status: 'scheduled',
      availableSeats: 10,
      fromPriceCents: 5000,
      heldSeats: 0,
      ...overrides,
    });

    it("passes today's UTC date to the repository as the upcoming cutoff", async () => {
      vi.useFakeTimers();
      // 23:30 in Madrid on the 16th is still the 16th in UTC.
      vi.setSystemTime(new Date('2026-10-16T21:30:00Z'));
      const repository = createMockRepository();
      (repository.listEventSummaries as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      const catalog = new EventCatalog(repository);

      await catalog.listEventSummaries();

      expect(repository.listEventSummaries).toHaveBeenCalledWith('2026-10-16');
    });

    it('lists performance summaries sorted by date then time, with the same cutoff', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
      const repository = createMockRepository();
      (repository.findEventById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(event);
      const later = summary({ performanceId: 'perf-2', time: '21:30:00' });
      const earlier = summary({ performanceId: 'perf-1', time: '14:00:00' });
      (repository.listPerformanceSummariesByEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce([later, earlier]);
      const catalog = new EventCatalog(repository);

      await expect(catalog.listPerformanceSummariesByEvent('event-1')).resolves.toEqual([earlier, later]);
      expect(repository.listPerformanceSummariesByEvent).toHaveBeenCalledWith('event-1', '2026-10-01');
    });

    it('throws EventNotFoundError for performance summaries of a missing event', async () => {
      const repository = createMockRepository();
      (repository.findEventById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      (repository.listPerformanceSummariesByEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
      const catalog = new EventCatalog(repository);

      await expect(catalog.listPerformanceSummariesByEvent('missing-event')).rejects.toBeInstanceOf(EventNotFoundError);
    });
  });
});
