const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const shortDateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/**
 * Builds a local `Date` from a performance's calendar `date` ('YYYY-MM-DD')
 * and `time` ('HH:MM' or 'HH:MM:SS') parts. Deliberately not `new Date(iso)`:
 * a date-only ISO string parses as UTC midnight, which a timezone west of UTC
 * would render as the previous day.
 */
function toLocalDate(date: string, time = '00:00'): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

/**
 * Formats a performance's date and time as e.g. "Sat 14 March 2026, 19:30" —
 * English UI, European 24-hour time, independent of the browser's locale.
 *
 * Assembled from `formatToParts` rather than `format()`: the separator
 * `format()` puts between the date and the time depends on the runtime's ICU
 * version (current Node/Chrome give "Sat, 14 March 2026 at 19:30", older
 * builds "Sat, 14 March 2026, 19:30"), so tests and the e2e would otherwise
 * depend on which runtime they happen to run on.
 */
export function formatPerformanceDateTime(date: string, time: string): string {
  const parts = Object.fromEntries(
    dateTimeFormatter.formatToParts(toLocalDate(date, time)).map((part) => [part.type, part.value])
  );
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}`;
}

/** Formats a calendar date ('YYYY-MM-DD') as e.g. "14 Mar". */
export function formatShortDate(date: string): string {
  return shortDateFormatter.format(toLocalDate(date));
}
