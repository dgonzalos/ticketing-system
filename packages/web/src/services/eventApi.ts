import type { EventDto, PerformanceDto } from '@ticketing-system/shared';
import type { Event, Performance } from '../components/Events/types';
import { API_BASE, parseErrorMessage } from './http';

function toEvent(dto: EventDto): Event {
  const { eventId, ...rest } = dto;
  return { id: eventId, ...rest };
}

function toPerformance(dto: PerformanceDto): Performance {
  const { performanceId, ...rest } = dto;
  return { id: performanceId, ...rest };
}

/** Lists every event. Public — no auth required. */
export async function listEvents(): Promise<Event[]> {
  const response = await fetch(`${API_BASE}/events`);
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to fetch events'));
  }
  const data: EventDto[] = await response.json();
  return data.map(toEvent);
}

/** Lists every performance scheduled for an event, sorted by date/time. Public — no auth required. */
export async function listPerformances(eventId: string): Promise<Performance[]> {
  const response = await fetch(`${API_BASE}/events/${encodeURIComponent(eventId)}/performances`);
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Failed to fetch performances'));
  }
  const data: PerformanceDto[] = await response.json();
  return data.map(toPerformance);
}
