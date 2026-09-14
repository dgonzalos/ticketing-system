import type { ZodError } from 'zod';
import { EventNotFoundError } from '../common/errors/domain-errors.js';
import type {
  CancelPerformanceCommand,
  CreateEventCommand,
  CreatePerformancesCommand,
  UpdateEventCommand,
} from '../events/catalog-commands.js';
import {
  CancelPerformanceCommandSchema,
  CreateEventCommandSchema,
  CreatePerformancesCommandSchema,
  UpdateEventCommandSchema,
} from '../events/catalog-commands.js';
import type { EventCatalog } from '../events/event-catalog.js';
import { isReadToolName, isToolName, type ReadToolName, type WriteToolName } from './admin-tools.js';
import { ListEventsInputSchema, ListPerformancesInputSchema } from './read-tool-schemas.js';

export type ToolExecutionOutcome =
  | { kind: 'executed'; result: unknown }
  | { kind: 'pending'; tool: WriteToolName; command: unknown; summary: string }
  | { kind: 'invalid'; message: string };

function summarizeZodError(error: ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

/**
 * These `summarize*` functions are the confirmation text a human sees before
 * `respond('confirm')` executes anything — they build that text from the
 * parsed, Zod-validated *command object* only, never from the model's own
 * narration. This matters because read-tool results (`list_events`/
 * `list_performances`) already return admin-authored free text (event
 * descriptions) that a *different* admin could have planted steering
 * instructions in — a live, if narrow, prompt-injection surface. Poisoned
 * text can influence what the model *says* in conversation, but it can't
 * make the confirmation summary claim something other than what the
 * validated command actually contains. Keep it that way: never substitute
 * model-generated text for a value read directly off `command` here.
 */
function summarizeCreateEvent(command: CreateEventCommand): string {
  return `Create event "${command.title}"`;
}

function summarizeUpdateEvent(command: UpdateEventCommand): string {
  const changes: string[] = [];
  if (command.title !== undefined) {
    changes.push(`title -> "${command.title}"`);
  }
  if (command.description !== undefined) {
    changes.push(`description -> ${command.description === null ? '(cleared)' : `"${command.description}"`}`);
  }
  if (command.imageUrl !== undefined) {
    changes.push(`imageUrl -> ${command.imageUrl === null ? '(cleared)' : `"${command.imageUrl}"`}`);
  }
  return `Update event ${command.eventId}: ${changes.join(', ')}`;
}

function summarizeCreatePerformances(command: CreatePerformancesCommand): string {
  return `Schedule ${command.performances.length} performance(s) for event ${command.eventId}`;
}

function summarizeCancelPerformance(command: CancelPerformanceCommand): string {
  return `Cancel performance ${command.performanceId}`;
}

/**
 * The actual enforcement point for the AI Admin Assistant's tool calls.
 * Constructor takes `EventCatalog` ONLY — never `EventAdminService` — so a
 * bug in the tool-calling loop that drives this class cannot make it
 * execute a mutation: nothing here ever holds a reference to the write
 * side, so there is nothing to call even if the loop logic is wrong.
 */
export class AdminToolExecutor {
  constructor(private readonly eventCatalog: EventCatalog) {}

  async execute(toolName: string, rawInput: unknown): Promise<ToolExecutionOutcome> {
    if (!isToolName(toolName)) {
      return { kind: 'invalid', message: `Unknown tool: ${toolName}` };
    }

    if (isReadToolName(toolName)) {
      return this.executeRead(toolName, rawInput);
    }

    return this.executeWrite(toolName, rawInput);
  }

  private async executeRead(toolName: ReadToolName, rawInput: unknown): Promise<ToolExecutionOutcome> {
    switch (toolName) {
      case 'list_events': {
        const parsed = ListEventsInputSchema.safeParse(rawInput);
        if (!parsed.success) {
          return { kind: 'invalid', message: summarizeZodError(parsed.error) };
        }
        const events = await this.eventCatalog.listEvents();
        return { kind: 'executed', result: events };
      }
      case 'list_performances': {
        const parsed = ListPerformancesInputSchema.safeParse(rawInput);
        if (!parsed.success) {
          return { kind: 'invalid', message: summarizeZodError(parsed.error) };
        }
        try {
          const performances = await this.eventCatalog.listPerformancesByEvent(parsed.data.eventId);
          return { kind: 'executed', result: performances };
        } catch (error) {
          // A hallucinated eventId is a modeling mistake the model can recover
          // from by retrying, not a crash — never let it escape as an
          // unhandled rejection out of the tool-calling loop. Any *other*
          // thrown error (a real DB/infra failure) is left to propagate.
          if (error instanceof EventNotFoundError) {
            return { kind: 'invalid', message: error.message };
          }
          throw error;
        }
      }
    }
  }

  private executeWrite(toolName: WriteToolName, rawInput: unknown): ToolExecutionOutcome {
    switch (toolName) {
      case 'create_event': {
        const parsed = CreateEventCommandSchema.safeParse(rawInput);
        if (!parsed.success) {
          return { kind: 'invalid', message: summarizeZodError(parsed.error) };
        }
        return { kind: 'pending', tool: toolName, command: parsed.data, summary: summarizeCreateEvent(parsed.data) };
      }
      case 'update_event': {
        const parsed = UpdateEventCommandSchema.safeParse(rawInput);
        if (!parsed.success) {
          return { kind: 'invalid', message: summarizeZodError(parsed.error) };
        }
        return { kind: 'pending', tool: toolName, command: parsed.data, summary: summarizeUpdateEvent(parsed.data) };
      }
      case 'create_performances': {
        const parsed = CreatePerformancesCommandSchema.safeParse(rawInput);
        if (!parsed.success) {
          return { kind: 'invalid', message: summarizeZodError(parsed.error) };
        }
        return { kind: 'pending', tool: toolName, command: parsed.data, summary: summarizeCreatePerformances(parsed.data) };
      }
      case 'cancel_performance': {
        const parsed = CancelPerformanceCommandSchema.safeParse(rawInput);
        if (!parsed.success) {
          return { kind: 'invalid', message: summarizeZodError(parsed.error) };
        }
        return { kind: 'pending', tool: toolName, command: parsed.data, summary: summarizeCancelPerformance(parsed.data) };
      }
    }
  }
}
