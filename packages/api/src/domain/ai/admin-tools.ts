import type Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';
import {
  CancelPerformanceCommandSchema,
  CreateEventCommandSchema,
  CreatePerformancesCommandSchema,
  UpdateEventCommandSchema,
} from '../events/catalog-commands.js';
import { ListEventsInputSchema, ListPerformancesInputSchema } from './read-tool-schemas.js';

/**
 * Extends `catalog-commands.ts`'s own "why Zod is allowed in domain/"
 * exception (see that file's doc comment) to `zod-to-json-schema` here too:
 * it's a pure schema transform with no I/O and no framework/storage
 * coupling, the same class of exception, applied to the same schemas.
 */

export const READ_TOOL_NAMES = ['list_events', 'list_performances'] as const;
export const WRITE_TOOL_NAMES = ['create_event', 'update_event', 'create_performances', 'cancel_performance'] as const;
export const ALL_TOOL_NAMES = [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES] as const;

export type ReadToolName = (typeof READ_TOOL_NAMES)[number];
export type WriteToolName = (typeof WRITE_TOOL_NAMES)[number];
export type ToolName = ReadToolName | WriteToolName;

export function isReadToolName(name: string): name is ReadToolName {
  return (READ_TOOL_NAMES as readonly string[]).includes(name);
}

export function isWriteToolName(name: string): name is WriteToolName {
  return (WRITE_TOOL_NAMES as readonly string[]).includes(name);
}

export function isToolName(name: string): name is ToolName {
  return isReadToolName(name) || isWriteToolName(name);
}

const TOOL_SCHEMAS: Record<ToolName, z.ZodTypeAny> = {
  list_events: ListEventsInputSchema,
  list_performances: ListPerformancesInputSchema,
  create_event: CreateEventCommandSchema,
  update_event: UpdateEventCommandSchema,
  create_performances: CreatePerformancesCommandSchema,
  cancel_performance: CancelPerformanceCommandSchema,
};

// zod-to-json-schema can't encode a `.refine()` predicate — UpdateEventCommandSchema's
// "at least one of title/description/imageUrl" rule is invisible to the resulting JSON
// Schema. Zod still enforces it (AdminToolExecutor re-validates with the real schema),
// so this is only a wasted-retry risk, not a safety gap — stated here in prose since
// that's the only channel left to tell the model about it.
const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  list_events: 'List every event in the catalog, with ids.',
  list_performances: 'List every performance for a given event id, including performance ids and status.',
  create_event: 'Create a new event.',
  update_event:
    "Update an existing event's title, description, or image URL. Must specify at least one of: title, description, imageUrl.",
  create_performances: 'Schedule one or more performances for an existing event.',
  cancel_performance: 'Cancel an existing performance by id. Fails if it already has sold seats.',
};

const WRITE_TOOL_CONFIRMATION_SUFFIX = ' This proposes the action for human confirmation — it does not execute immediately.';

/** Builds the tool definitions sent to Anthropic on every call — kept short, since this is sent every time. */
export function buildToolDefinitions(): Anthropic.Tool[] {
  return ALL_TOOL_NAMES.map((name) => {
    const jsonSchema = zodToJsonSchema(TOOL_SCHEMAS[name], { $refStrategy: 'none' }) as Record<string, unknown>;
    delete jsonSchema.$schema;

    return {
      name,
      description: TOOL_DESCRIPTIONS[name] + (isWriteToolName(name) ? WRITE_TOOL_CONFIRMATION_SUFFIX : ''),
      input_schema: jsonSchema as Anthropic.Tool['input_schema'],
    };
  });
}
