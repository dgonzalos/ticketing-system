import { describe, expect, it } from 'vitest';
import { formatDateParts, formatPerformanceDateTime, formatShortDate, formatTime } from './dates';

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

describe('formatTime', () => {
  it('trims seconds from a 24-hour time', () => {
    expect(formatTime('19:30:00')).toBe('19:30');
    expect(formatTime('09:05')).toBe('09:05');
  });
});

describe('formatDateParts', () => {
  it('splits a date into weekday, day and short month', () => {
    expect(formatDateParts('2026-03-14')).toEqual({ weekday: 'Sat', day: '14', month: 'Mar' });
  });

  it('does not zero-pad the day', () => {
    expect(formatDateParts('2026-10-06')).toEqual({ weekday: 'Tue', day: '6', month: 'Oct' });
  });
});
