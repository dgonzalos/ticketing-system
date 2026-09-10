import { describe, expect, it, vi } from 'vitest';
import {
  EventNotFoundError,
  PerformanceAlreadyScheduledError,
  PerformanceHasSalesError,
  PerformanceNotFoundError,
} from '../../../../src/domain/common/errors/domain-errors.js';
import { EventAdminService } from '../../../../src/domain/events/event-admin.service.js';
import type { Event, IEventRepository, Performance } from '../../../../src/domain/events/event.repository.js';
import { generateSeatMap } from '../../../../src/domain/seats/seat-map.js';

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
  };
}

const event: Event = { eventId: 'event-1', title: 'Hamilton', description: null, imageUrl: null };

function performance(overrides: Partial<Performance> = {}): Performance {
  return {
    performanceId: 'perf-1',
    eventId: 'event-1',
    date: '2026-10-02',
    time: '20:00:00',
    venue: 'Orpheum Theatre',
    city: 'Seattle',
    capacity: 100,
    status: 'scheduled',
    ...overrides,
  };
}

describe('EventAdminService', () => {
  describe('createEvent', () => {
    it('creates an event with a generated id', async () => {
      const repository = createMockRepository();
      (repository.createEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(event);
      const service = new EventAdminService(repository);

      const result = await service.createEvent({ title: 'Hamilton' });

      expect(repository.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Hamilton', description: null, imageUrl: null })
      );
      const [callArg] = (repository.createEvent as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(typeof callArg.eventId).toBe('string');
      expect(callArg.eventId.length).toBeGreaterThan(0);
      expect(result).toBe(event);
    });
  });

  describe('updateEvent', () => {
    it('throws EventNotFoundError when the repository reports no matching row', async () => {
      const repository = createMockRepository();
      (repository.updateEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      const service = new EventAdminService(repository);

      await expect(service.updateEvent({ eventId: 'missing-event', title: 'New Title' })).rejects.toBeInstanceOf(
        EventNotFoundError
      );
    });

    it('updates and returns the event on success', async () => {
      const repository = createMockRepository();
      const updated = { ...event, title: 'Hamilton (Revival)' };
      (repository.updateEvent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updated);
      const service = new EventAdminService(repository);

      const result = await service.updateEvent({ eventId: 'event-1', title: 'Hamilton (Revival)' });

      expect(repository.updateEvent).toHaveBeenCalledWith('event-1', { title: 'Hamilton (Revival)' });
      expect(result).toBe(updated);
    });
  });

  describe('createPerformances', () => {
    it('throws EventNotFoundError when the event does not exist', async () => {
      const repository = createMockRepository();
      (repository.findEventById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      const service = new EventAdminService(repository);

      await expect(
        service.createPerformances({
          eventId: 'missing-event',
          performances: [{ date: '2026-10-02', time: '20:00:00', venue: 'Orpheum Theatre', city: 'Seattle' }],
        })
      ).rejects.toBeInstanceOf(EventNotFoundError);
    });

    it('creates all performances in one repository call, generating a seat map per performance', async () => {
      const repository = createMockRepository();
      (repository.findEventById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(event);
      (repository.findScheduledPerformance as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (repository.createPerformances as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        performance({ performanceId: 'p1' }),
        performance({ performanceId: 'p2' }),
        performance({ performanceId: 'p3' }),
      ]);
      const service = new EventAdminService(repository);

      await service.createPerformances({
        eventId: 'event-1',
        performances: [
          { date: '2026-10-02', time: '20:00:00', venue: 'Orpheum Theatre', city: 'Seattle' },
          { date: '2026-10-09', time: '20:00:00', venue: 'Orpheum Theatre', city: 'Seattle' },
          { date: '2026-10-16', time: '20:00:00', venue: 'Orpheum Theatre', city: 'Seattle' },
        ],
      });

      expect(repository.createPerformances).toHaveBeenCalledTimes(1);
      const [rows, seatsFor] = (repository.createPerformances as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(rows).toHaveLength(3);
      expect(seatsFor).toBe(generateSeatMap);

      const ids = rows.map((row: { performanceId: string }) => row.performanceId);
      expect(new Set(ids).size).toBe(3);
    });

    it('defaults capacity to the generated seat map size when omitted', async () => {
      const repository = createMockRepository();
      (repository.findEventById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(event);
      (repository.findScheduledPerformance as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (repository.createPerformances as ReturnType<typeof vi.fn>).mockResolvedValueOnce([performance()]);
      const service = new EventAdminService(repository);

      await service.createPerformances({
        eventId: 'event-1',
        performances: [{ date: '2026-10-02', time: '20:00:00', venue: 'Orpheum Theatre', city: 'Seattle' }],
      });

      const [rows] = (repository.createPerformances as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(rows[0].capacity).toBe(100);
    });

    it('throws PerformanceAlreadyScheduledError against an existing scheduled performance', async () => {
      const repository = createMockRepository();
      (repository.findEventById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(event);
      (repository.findScheduledPerformance as ReturnType<typeof vi.fn>).mockResolvedValueOnce(performance());
      const service = new EventAdminService(repository);

      await expect(
        service.createPerformances({
          eventId: 'event-1',
          performances: [{ date: '2026-10-02', time: '20:00:00', venue: 'Orpheum Theatre', city: 'Seattle' }],
        })
      ).rejects.toBeInstanceOf(PerformanceAlreadyScheduledError);

      expect(repository.createPerformances).not.toHaveBeenCalled();
    });

    it('throws PerformanceAlreadyScheduledError for a duplicate within the submitted batch, without calling the repository', async () => {
      const repository = createMockRepository();
      (repository.findEventById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(event);
      (repository.findScheduledPerformance as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const service = new EventAdminService(repository);

      await expect(
        service.createPerformances({
          eventId: 'event-1',
          performances: [
            { date: '2026-10-02', time: '20:00:00', venue: 'Orpheum Theatre', city: 'Seattle' },
            { date: '2026-10-02', time: '20:00:00', venue: 'Orpheum Theatre', city: 'Seattle' },
          ],
        })
      ).rejects.toBeInstanceOf(PerformanceAlreadyScheduledError);

      expect(repository.createPerformances).not.toHaveBeenCalled();
    });

    it('identifies the correct performance when a duplicate against existing data is not the first item in the batch', async () => {
      const repository = createMockRepository();
      (repository.findEventById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(event);
      // Only the second submitted performance (Paramount Theatre) matches
      // an existing scheduled row — the other two resolve null. Since the
      // duplicate-vs-existing checks now run via Promise.all rather than a
      // sequential loop (see finding #5), this also confirms every check
      // still fires — not just the first one up to the match — and that
      // the reported error correctly identifies the actual colliding
      // performance rather than, say, always the first item.
      (repository.findScheduledPerformance as ReturnType<typeof vi.fn>).mockImplementation(
        async (_eventId: string, _date: string, _time: string, venue: string) =>
          venue === 'Paramount Theatre' ? performance({ venue: 'Paramount Theatre' }) : null
      );
      const service = new EventAdminService(repository);

      const error = await service
        .createPerformances({
          eventId: 'event-1',
          performances: [
            { date: '2026-10-02', time: '20:00:00', venue: 'Orpheum Theatre', city: 'Seattle' },
            { date: '2026-10-09', time: '20:00:00', venue: 'Paramount Theatre', city: 'Seattle' },
            { date: '2026-10-16', time: '20:00:00', venue: 'Blue Note', city: 'New York' },
          ],
        })
        .catch((e) => e);

      expect(error).toBeInstanceOf(PerformanceAlreadyScheduledError);
      expect((error as PerformanceAlreadyScheduledError).venue).toBe('Paramount Theatre');
      expect((error as PerformanceAlreadyScheduledError).date).toBe('2026-10-09');
      expect(repository.findScheduledPerformance).toHaveBeenCalledTimes(3);
      expect(repository.createPerformances).not.toHaveBeenCalled();
    });
  });

  describe('cancelPerformance', () => {
    // The existence check, sold-seats check, and the actual write all
    // happen atomically inside the repository's own cancelPerformance
    // (locked in one transaction — see DrizzleEventRepository), precisely
    // so a concurrent checkout can't sell a seat in the gap between a
    // separate check and a separate write. The service layer's only job is
    // mapping the repository's outcome to the right domain error, so these
    // tests exercise that mapping, not repository internals (which belong
    // to the integration test in tests/integration/cancel-performance.test.ts).

    it('throws PerformanceNotFoundError when the repository reports not_found', async () => {
      const repository = createMockRepository();
      (repository.cancelPerformance as ReturnType<typeof vi.fn>).mockResolvedValueOnce('not_found');
      const service = new EventAdminService(repository);

      await expect(service.cancelPerformance({ performanceId: 'missing' })).rejects.toBeInstanceOf(
        PerformanceNotFoundError
      );
    });

    it('throws PerformanceHasSalesError when the repository reports has_sales', async () => {
      const repository = createMockRepository();
      (repository.cancelPerformance as ReturnType<typeof vi.fn>).mockResolvedValueOnce('has_sales');
      const service = new EventAdminService(repository);

      await expect(service.cancelPerformance({ performanceId: 'perf-1' })).rejects.toBeInstanceOf(
        PerformanceHasSalesError
      );
    });

    it('resolves normally when the repository reports cancelled', async () => {
      const repository = createMockRepository();
      (repository.cancelPerformance as ReturnType<typeof vi.fn>).mockResolvedValueOnce('cancelled');
      const service = new EventAdminService(repository);

      await expect(service.cancelPerformance({ performanceId: 'perf-1' })).resolves.toBeUndefined();
      expect(repository.cancelPerformance).toHaveBeenCalledWith('perf-1');
    });
  });
});
