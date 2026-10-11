import { describe, expect, it, vi } from 'vitest';
import type { IAnalyticsRepository, PerformanceOccupancyRow } from '../../../../src/domain/analytics/analytics.repository.js';
import { AnalyticsService } from '../../../../src/domain/analytics/analytics.service.js';
import { InvalidDateRangeError } from '../../../../src/domain/common/errors/domain-errors.js';

const NOW = new Date('2026-10-06T15:00:00Z');

function createMockRepository(): IAnalyticsRepository {
  return {
    getPerformanceOccupancy: vi.fn().mockResolvedValue([]),
    getRevenue: vi.fn().mockResolvedValue([]),
    getOrderFunnel: vi.fn().mockResolvedValue([]),
  };
}

function occupancyRow(overrides: Partial<PerformanceOccupancyRow>): PerformanceOccupancyRow {
  return {
    performanceId: 'perf-1',
    eventId: 'event-1',
    eventTitle: 'Hamlet',
    date: '2026-11-01',
    time: '20:00:00',
    venue: 'Teatro',
    city: 'Madrid',
    status: 'scheduled',
    totalSeats: 0,
    soldSeats: 0,
    heldSeats: 0,
    availableSeats: 0,
    blockedSeats: 0,
    ...overrides,
  };
}

describe('AnalyticsService', () => {
  describe('resolveRange', () => {
    const service = new AnalyticsService(createMockRepository(), () => NOW);

    it('defaults to the last 30 days, today included, counted in Madrid time', () => {
      expect(service.resolveRange({})).toEqual({ from: '2026-09-07', to: '2026-10-06', timeZone: 'Europe/Madrid' });
    });

    it("takes today from Madrid's clock, not UTC's, around midnight", () => {
      // 22:30 UTC on 6 Oct is already 00:30 on 7 Oct in Madrid (CEST, UTC+2)...
      const lateUtc = new AnalyticsService(createMockRepository(), () => new Date('2026-10-06T22:30:00Z'));
      expect(lateUtc.resolveRange({}).to).toBe('2026-10-07');
      // ...and 23:30 UTC on 31 Dec is 00:30 on 1 Jan in Madrid in winter (CET, UTC+1).
      const newYear = new AnalyticsService(createMockRepository(), () => new Date('2026-12-31T23:30:00Z'));
      expect(newYear.resolveRange({}).to).toBe('2027-01-01');
    });

    it('defaults from to 30 days ending at a given to', () => {
      expect(service.resolveRange({ to: '2026-03-31' })).toMatchObject({ from: '2026-03-02', to: '2026-03-31' });
    });

    it('counts default days across a daylight-saving change without drifting', () => {
      // 29 March 2026 is a 23-hour day in Madrid; the range must still be 30 calendar days.
      expect(service.resolveRange({ to: '2026-04-15' })).toMatchObject({ from: '2026-03-17', to: '2026-04-15' });
    });

    it('accepts a single-day range', () => {
      expect(service.resolveRange({ from: '2026-01-01', to: '2026-01-01' })).toMatchObject({ from: '2026-01-01', to: '2026-01-01' });
    });

    it('accepts exactly 366 days and rejects 367', () => {
      expect(service.resolveRange({ from: '2024-01-01', to: '2024-12-31' })).toMatchObject({ from: '2024-01-01', to: '2024-12-31' });
      expect(() => service.resolveRange({ from: '2024-01-01', to: '2025-01-01' })).toThrow(InvalidDateRangeError);
    });

    it('rejects from after to', () => {
      expect(() => service.resolveRange({ from: '2026-05-02', to: '2026-05-01' })).toThrow(InvalidDateRangeError);
    });

    it('rejects a date that does not exist rather than rolling it over', () => {
      expect(() => service.resolveRange({ from: '2026-02-30', to: '2026-03-05' })).toThrow(InvalidDateRangeError);
    });

    it('rejects a malformed date', () => {
      expect(() => service.resolveRange({ from: '01/02/2026' })).toThrow(InvalidDateRangeError);
    });
  });

  describe('getPerformanceOccupancy', () => {
    it("passes today's Madrid date and includePast=false by default", async () => {
      const repository = createMockRepository();
      await new AnalyticsService(repository, () => NOW).getPerformanceOccupancy({ eventId: 'event-1' });
      expect(repository.getPerformanceOccupancy).toHaveBeenCalledWith({ eventId: 'event-1', includePast: false, today: '2026-10-06' });
    });

    it('adds sell-through to one decimal, null when a performance has no seats', async () => {
      const repository = createMockRepository();
      vi.mocked(repository.getPerformanceOccupancy).mockResolvedValue([
        occupancyRow({ performanceId: 'a', totalSeats: 3, soldSeats: 1 }),
        occupancyRow({ performanceId: 'b', totalSeats: 0 }),
      ]);

      const rows = await new AnalyticsService(repository, () => NOW).getPerformanceOccupancy();
      expect(rows.map((r) => r.sellThroughPercent)).toEqual([33.3, null]);
    });
  });

  describe('getRevenueSummary', () => {
    it('groups by event by default and totals the rows', async () => {
      const repository = createMockRepository();
      vi.mocked(repository.getRevenue).mockResolvedValue([
        { eventId: 'e1', eventTitle: 'A', performanceId: null, date: null, time: null, completedOrders: 2, ticketsSold: 3, revenueCents: 49500 },
        { eventId: 'e2', eventTitle: 'B', performanceId: null, date: null, time: null, completedOrders: 1, ticketsSold: 1, revenueCents: 5500 },
      ]);

      const summary = await new AnalyticsService(repository, () => NOW).getRevenueSummary();

      expect(repository.getRevenue).toHaveBeenCalledWith({ from: '2026-09-07', to: '2026-10-06', timeZone: 'Europe/Madrid' }, 'event');
      expect(summary).toMatchObject({
        groupBy: 'event',
        currency: 'EUR',
        totals: { completedOrders: 3, ticketsSold: 4, revenueCents: 55000 },
      });
    });

    it('does not query with an invalid range', async () => {
      const repository = createMockRepository();
      await expect(
        new AnalyticsService(repository, () => NOW).getRevenueSummary({ from: '2026-05-02', to: '2026-05-01' })
      ).rejects.toThrow(InvalidDateRangeError);
      expect(repository.getRevenue).not.toHaveBeenCalled();
    });
  });

  describe('getOrderFunnel', () => {
    it('zero-fills every status in lifecycle order and computes the completion rate', async () => {
      const repository = createMockRepository();
      vi.mocked(repository.getOrderFunnel).mockResolvedValue([
        { status: 'cancelled', orders: 1, amountCents: 11000 },
        { status: 'completed', orders: 3, amountCents: 55000 },
      ]);

      const funnel = await new AnalyticsService(repository, () => NOW).getOrderFunnel({ from: '2026-10-01', to: '2026-10-06' });

      expect(funnel.statuses).toEqual([
        { status: 'pending', orders: 0, amountCents: 0 },
        { status: 'payment_processing', orders: 0, amountCents: 0 },
        { status: 'completed', orders: 3, amountCents: 55000 },
        { status: 'cancelled', orders: 1, amountCents: 11000 },
      ]);
      expect(funnel.totalOrders).toBe(4);
      expect(funnel.completionRatePercent).toBe(75);
    });

    it('reports a null completion rate when there are no orders', async () => {
      const funnel = await new AnalyticsService(createMockRepository(), () => NOW).getOrderFunnel();
      expect(funnel.totalOrders).toBe(0);
      expect(funnel.completionRatePercent).toBeNull();
    });
  });
});
