import type { EventDto, PerformanceDto } from '@ticketing-system/shared';

/**
 * An event, as rendered by the Events components. Same fields as the
 * shared `EventDto` wire type, with `eventId` renamed to `id` for component
 * ergonomics — derived from it, not redeclared.
 */
export interface Event extends Omit<EventDto, 'eventId'> {
  id: string;
}

/**
 * A performance, as rendered by the Events components. Same fields as the
 * shared `PerformanceDto` wire type, with `performanceId` renamed to `id`.
 */
export interface Performance extends Omit<PerformanceDto, 'performanceId'> {
  id: string;
}

export interface EventSelectorProps {
  events: Event[];
  onSelect: (event: Event) => void;
}

export interface PerformanceSelectorProps {
  performances: Performance[];
  onSelect: (performance: Performance) => void;
}
