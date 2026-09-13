import { z } from 'zod';

/**
 * Input schemas for the AI Admin Assistant's read-only tools. Unlike
 * `catalog-commands.ts`, these have no second consumer outside the AI
 * tool-calling layer — no HTTP route accepts `{ eventId }` as a request
 * body — so they don't need that file's "why Zod lives in domain/"
 * justification; they're simply colocated with the rest of `domain/ai/`.
 */

export const ListEventsInputSchema = z.object({});
export type ListEventsInput = z.infer<typeof ListEventsInputSchema>;

export const ListPerformancesInputSchema = z.object({
  eventId: z.string().describe('Id of the event to list performances for'),
});
export type ListPerformancesInput = z.infer<typeof ListPerformancesInputSchema>;
