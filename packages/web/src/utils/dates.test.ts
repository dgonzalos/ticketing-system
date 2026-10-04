import { describe, expect, it } from 'vitest';
import { formatPerformanceDateTime, formatShortDate } from './dates';

describe('formatPerformanceDateTime', () => {
  it('formats a date and time as "Sat 14 March 2026, 19:30"', () => {
    expect(formatPerformanceDateTime('2026-03-14', '19:30:00')).toBe('Sat 14 March 2026, 19:30');
  });

  it('uses 24-hour time with a leading zero', () => {
    expect(formatPerformanceDateTime('2026-03-15', '09:05:00')).toBe('Sun 15 March 2026, 09:05');
  });

  it('never shifts a late performance onto a neighbouring day', () => {
    expect(formatPerformanceDateTime('2026-03-14', '23:45:00')).toBe('Sat 14 March 2026, 23:45');
    expect(formatPerformanceDateTime('2026-03-14', '00:15:00')).toBe('Sat 14 March 2026, 00:15');
  });
});

describe('formatShortDate', () => {
  it('formats a calendar date as "14 Mar"', () => {
    expect(formatShortDate('2026-03-14')).toBe('14 Mar');
  });
});
