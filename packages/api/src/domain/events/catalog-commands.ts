import { z } from 'zod';

/**
 * Zod schemas for admin catalog commands — the single validated contract
 * both the HTTP routes (`api/routes/admin/catalog.ts`) and, later, an AI
 * Admin Assistant's tool-calling layer parse requests into.
 *
 * This is a deliberate, narrow exception to "domain must be framework-free"
 * (see CLAUDE.md's Architecture section: the rule that matters is no
 * Fastify / no pg / no Drizzle). Zod is none of those — it has no I/O and no
 * runtime/delivery-mechanism coupling, so importing it here doesn't tie
 * domain logic to HTTP or to any particular storage engine, which is what
 * the framework-free rule actually protects against.
 *
 * The reason this lives in `domain/` rather than the routes layer (where
 * every other Zod schema in this codebase lives today, e.g. `auth.ts`'s
 * `signupBodySchema`) is that a second consumer outside the HTTP layer is a
 * concrete, named future requirement here — the AI Admin Assistant needs the
 * exact same validated shape, `.describe()` field-by-field. Domain is the
 * shared core both the route layer and that future layer sit on top of;
 * putting the schema in either adapter would make the other import across a
 * layer boundary it shouldn't. If a second cross-layer-shared Zod schema
 * ever appears outside `events/`, promote this pattern to a dedicated
 * shared module instead of repeating this exception ad hoc per context.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}:\d{2}$/;

export const CreateEventCommandSchema = z.object({
  title: z.string().min(1).describe('Display title of the event'),
  description: z.string().nullable().optional().describe('Optional long-form description'),
  imageUrl: z.string().url().nullable().optional().describe('Optional promotional image URL'),
});
export type CreateEventCommand = z.infer<typeof CreateEventCommandSchema>;

export const UpdateEventCommandSchema = z
  .object({
    eventId: z.string().describe('Id of the event to update'),
    title: z.string().min(1).optional().describe('New title'),
    description: z.string().nullable().optional().describe('New description'),
    imageUrl: z.string().url().nullable().optional().describe('New promotional image URL'),
  })
  .refine((command) => command.title !== undefined || command.description !== undefined || command.imageUrl !== undefined, {
    message: 'At least one of title, description, or imageUrl must be provided',
  });
export type UpdateEventCommand = z.infer<typeof UpdateEventCommandSchema>;

const PerformanceInputSchema = z.object({
  date: z.string().regex(DATE_PATTERN).describe("Performance date, 'YYYY-MM-DD'"),
  time: z.string().regex(TIME_PATTERN).describe("Performance start time, 'HH:MM:SS'"),
  venue: z.string().min(1).describe('Venue name'),
  city: z.string().min(1).describe('City the venue is in'),
  // Informational only — mirrors the `capacity` column's own "not
  // recomputed from the seats table" semantics (see schema/performances.ts).
  // `generateSeatMap` takes no capacity argument and always produces the
  // fixed 10x10 layout; a value supplied here never changes seat count.
  capacity: z.number().int().positive().optional().describe('Informational seat-count override — does not affect actual seat generation'),
});

export const CreatePerformancesCommandSchema = z.object({
  eventId: z.string().describe('Event these performances belong to'),
  performances: z.array(PerformanceInputSchema).min(1).max(50).describe('Batch of performances to schedule'),
});
export type CreatePerformancesCommand = z.infer<typeof CreatePerformancesCommandSchema>;

export const CancelPerformanceCommandSchema = z.object({
  performanceId: z.string().describe('Performance to cancel'),
});
export type CancelPerformanceCommand = z.infer<typeof CancelPerformanceCommandSchema>;
