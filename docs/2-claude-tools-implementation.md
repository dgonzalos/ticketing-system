# 2. CLAUDE TOOLS — Complete Implementation

## CONCEPTOS CLAVE

### ¿Qué es un Tool?

Un **tool** es una función que Claude puede llamar automáticamente.

```
Usuario: "Busca eventos románticos"
  ↓
Claude entiende que necesita buscar
  ↓
Claude llama automáticamente search_events(genres=['romance'])
  ↓
Backend ejecuta la búsqueda
  ↓
Retorna resultados a Claude
  ↓
Claude retorna respuesta al usuario
```

**Sin tools:**
- Claude: "Sí, buscaré eventos románticos... (pero no puede hacer nada)"

**Con tools:**
- Claude: "Voy a usar search_events para encontrarlos"
- Claude llama el tool automáticamente
- Claude ve los resultados
- Claude retorna insights

---

## ARQUITECTURA DE TOOLS

```
┌─────────────────────────────────────┐
│ Tool Definition (Schema)            │
│ ├─ name: "search_events"            │
│ ├─ description: "..."               │
│ └─ input_schema: { zod schema }     │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│ Tool Executor (Implementación)      │
│ ├─ validate input                   │
│ ├─ execute business logic           │
│ └─ return result                    │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│ Tool Handler (Orquestación)         │
│ ├─ send to Claude                   │
│ ├─ detect tool calls                │
│ ├─ execute tools                    │
│ └─ loop until done                  │
└─────────────────────────────────────┘
```

---

## IMPLEMENTACIÓN PASO A PASO

### PASO 1: Definir Tool Schema

```typescript
// packages/api/src/ai/tools/search-events.ts

import { z } from 'zod';

/**
 * Input schema con Zod
 * Define QUÉ puede recibir Claude
 */
export const SearchEventsInputSchema = z.object({
  genres: z
    .array(z.string())
    .optional()
    .describe('Event genres: music, theater, sports, etc'),
  
  min_price: z
    .number()
    .min(0)
    .optional()
    .describe('Minimum ticket price'),
  
  max_price: z
    .number()
    .min(0)
    .optional()
    .describe('Maximum ticket price'),
  
  from_date: z
    .string()
    .datetime()
    .optional()
    .describe('Start date (ISO 8601)'),
  
  to_date: z
    .string()
    .datetime()
    .optional()
    .describe('End date (ISO 8601)'),

  limit: z
    .number()
    .min(1)
    .max(50)
    .default(10)
    .describe('Max results to return'),
});

export type SearchEventsInput = z.infer<typeof SearchEventsInputSchema>;

/**
 * Output schema
 * Define QUÉ retorna el tool
 */
export const SearchEventsOutputSchema = z.object({
  success: z.boolean(),
  data: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      genre: z.string(),
      minPrice: z.number(),
      maxPrice: z.number(),
      performanceCount: z.number(),
    })
  ),
  total: z.number(),
  error: z.string().optional(),
});

export type SearchEventsOutput = z.infer<typeof SearchEventsOutputSchema>;
```

---

### PASO 2: Implementar Tool Executor

```typescript
// packages/api/src/ai/tools/search-events.ts (continuación)

import { EventService } from '@/domain/events/event.service';

export class SearchEventsTool {
  constructor(private eventService: EventService) {}

  /**
   * Retornar definición del tool para Claude
   */
  getDefinition() {
    return {
      name: 'search_events',
      description:
        'Search for events by genre, price range, and date. Use this to find concerts, theater, sports events, etc.',
      input_schema: {
        type: 'object' as const,
        properties: {
          genres: {
            type: 'array',
            items: { type: 'string' },
            description: 'Event genres (e.g., music, theater, sports)',
          },
          min_price: {
            type: 'number',
            description: 'Minimum ticket price',
          },
          max_price: {
            type: 'number',
            description: 'Maximum ticket price',
          },
          from_date: {
            type: 'string',
            description: 'Start date (ISO 8601)',
          },
          to_date: {
            type: 'string',
            description: 'End date (ISO 8601)',
          },
          limit: {
            type: 'number',
            description: 'Max results (1-50)',
          },
        },
        required: [], // Todos opcionales
      },
    };
  }

  /**
   * Ejecutar el tool
   * Claude llama esto automáticamente
   */
  async execute(input: unknown): Promise<SearchEventsOutput> {
    try {
      // 1. Validar input con Zod
      const validated = SearchEventsInputSchema.parse(input);

      console.log('🔍 Searching events with filters:', validated);

      // 2. Ejecutar negocio
      const events = await this.eventService.search({
        genres: validated.genres,
        priceRange: validated.min_price
          ? [validated.min_price, validated.max_price ?? 10000]
          : undefined,
        fromDate: validated.from_date
          ? new Date(validated.from_date)
          : undefined,
        toDate: validated.to_date ? new Date(validated.to_date) : undefined,
      });

      // 3. Formatear resultado
      return {
        success: true,
        data: events.slice(0, validated.limit),
        total: events.length,
      };
    } catch (error) {
      // Error handling
      const message =
        error instanceof z.ZodError
          ? `Invalid input: ${error.errors[0].message}`
          : error instanceof Error
            ? error.message
            : 'Unknown error';

      console.error('❌ Search tool error:', message);

      return {
        success: false,
        data: [],
        total: 0,
        error: message,
      };
    }
  }
}
```

---

### PASO 3: Definir Otros Tools

```typescript
// packages/api/src/ai/tools/get-event-details.ts

export const GetDetailsInputSchema = z.object({
  event_id: z.string().describe('Event ID to get details for'),
});

export class GetDetailsTool {
  constructor(private eventService: EventService) {}

  getDefinition() {
    return {
      name: 'get_event_details',
      description:
        'Get detailed information about a specific event including all performances and pricing',
      input_schema: {
        type: 'object',
        properties: {
          event_id: {
            type: 'string',
            description: 'Event ID',
          },
        },
        required: ['event_id'],
      },
    };
  }

  async execute(input: unknown) {
    try {
      const validated = GetDetailsInputSchema.parse(input);
      const event = await this.eventService.getDetails(validated.event_id);

      return {
        success: true,
        data: event,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// packages/api/src/ai/tools/check-availability.ts

export const CheckAvailabilityInputSchema = z.object({
  performance_id: z
    .string()
    .describe('Performance ID to check availability'),
  seat_ids: z
    .array(z.string())
    .optional()
    .describe('Specific seat IDs to check (leave empty to get overview)'),
});

export class CheckAvailabilityTool {
  constructor(private seatService: SeatService) {}

  getDefinition() {
    return {
      name: 'check_availability',
      description:
        'Check seat availability for a specific performance',
      input_schema: {
        type: 'object',
        properties: {
          performance_id: { type: 'string' },
          seat_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['performance_id'],
      },
    };
  }

  async execute(input: unknown) {
    try {
      const validated = CheckAvailabilityInputSchema.parse(input);

      const availability = await this.seatService.checkAvailability(
        validated.performance_id,
        validated.seat_ids
      );

      return {
        success: true,
        data: availability,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
```

---

### PASO 4: Registrar Tools

```typescript
// packages/api/src/ai/tools/tools.registry.ts

import { SearchEventsTool } from './search-events';
import { GetDetailsTool } from './get-event-details';
import { CheckAvailabilityTool } from './check-availability';

export class ToolsRegistry {
  private tools: Map<string, any>;

  constructor(
    private eventService: EventService,
    private seatService: SeatService
  ) {
    this.tools = new Map();
    this.registerTools();
  }

  private registerTools() {
    const searchTool = new SearchEventsTool(this.eventService);
    const detailsTool = new GetDetailsTool(this.eventService);
    const availabilityTool = new CheckAvailabilityTool(this.seatService);

    this.tools.set('search_events', searchTool);
    this.tools.set('get_event_details', detailsTool);
    this.tools.set('check_availability', availabilityTool);
  }

  /**
   * Retornar definiciones para Claude
   */
  getDefinitions() {
    return Array.from(this.tools.values()).map((tool) =>
      tool.getDefinition()
    );
  }

  /**
   * Ejecutar un tool por nombre
   */
  async execute(toolName: string, input: unknown) {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    return tool.execute(input);
  }
}
```

---

### PASO 5: Handler Multi-Turn

```typescript
// packages/api/src/ai/handlers/search-handler.ts

import Anthropic from '@anthropic-ai/sdk';
import { ToolsRegistry } from '../tools/tools.registry';

interface SearchResult {
  recommendations: any[];
  reasoning: string;
  toolCalls: Array<{
    toolName: string;
    input: unknown;
    result: unknown;
  }>;
}

export class SearchHandler {
  private client: Anthropic;
  private toolsRegistry: ToolsRegistry;

  constructor(toolsRegistry: ToolsRegistry) {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    this.toolsRegistry = toolsRegistry;
  }

  /**
   * Orquestar multi-turn conversation con Claude
   * 
   * Flujo:
   * 1. Usuario envía query
   * 2. Claude responde con tool calls
   * 3. Ejecutar los tools
   * 4. Pasar resultados a Claude
   * 5. Claude genera respuesta final
   * 6. Retornar al usuario
   */
  async handle(query: string, userId: string): Promise<SearchResult> {
    const messages: Anthropic.Messages.MessageParam[] = [
      {
        role: 'user',
        content: query,
      },
    ];

    const toolCalls: SearchResult['toolCalls'] = [];
    let continueLoop = true;
    let finalReasoning = '';

    // Safety: máximo 5 iteraciones
    const maxIterations = 5;
    let iteration = 0;

    while (continueLoop && iteration < maxIterations) {
      iteration++;

      console.log(`[Iteration ${iteration}] Calling Claude...`);

      // Llamar a Claude con tools disponibles
      const response = await this.client.messages.create({
        model: 'claude-opus-4',
        max_tokens: 2048,
        tools: this.toolsRegistry.getDefinitions() as Anthropic.Messages.Tool[],
        messages,
      });

      console.log(`Claude response:`, {
        stopReason: response.stop_reason,
        contentCount: response.content.length,
      });

      // Procesar content blocks
      const assistantContent: Anthropic.Messages.ContentBlockParam[] = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          // Claude escribió texto
          finalReasoning += block.text;
          assistantContent.push(block);
        }

        if (block.type === 'tool_use') {
          // Claude quiere usar un tool
          console.log(`📞 Claude llamó tool: ${block.name}`);

          assistantContent.push(block);

          try {
            // Ejecutar el tool
            const toolResult = await this.toolsRegistry.execute(
              block.name,
              block.input
            );

            console.log(`✅ Tool result:`, {
              toolName: block.name,
              success: toolResult.success,
            });

            // Guardar para debugging
            toolCalls.push({
              toolName: block.name,
              input: block.input,
              result: toolResult,
            });

            // Pasar resultado a Claude en siguiente mensaje
            messages.push({
              role: 'assistant',
              content: assistantContent,
            });

            messages.push({
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: JSON.stringify(toolResult),
                },
              ],
            });

            // Resetear para siguiente iteración
            assistantContent.length = 0;
          } catch (error) {
            console.error(`❌ Tool error:`, error);

            messages.push({
              role: 'assistant',
              content: assistantContent,
            });

            messages.push({
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: JSON.stringify({
                    success: false,
                    error:
                      error instanceof Error
                        ? error.message
                        : 'Unknown error',
                  }),
                  is_error: true,
                },
              ],
            });
          }
        }
      }

      // Determinar si continuar
      if (response.stop_reason === 'end_turn') {
        // Claude terminó de hablar
        continueLoop = false;
      } else if (response.stop_reason === 'tool_use') {
        // Claude usó tools, continuar para procesar resultados
        continueLoop = true;
      } else {
        // Otro stop reason
        continueLoop = false;
      }
    }

    // Extraer recomendaciones
    const recommendations = toolCalls
      .filter((tc) => tc.toolName === 'search_events')
      .flatMap((tc) => (tc.result as any).data || []);

    return {
      recommendations,
      reasoning: finalReasoning,
      toolCalls,
    };
  }
}
```

---

### PASO 6: API Route

```typescript
// packages/api/src/api/routes/search.ts

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SearchHandler } from '@/ai/handlers/search-handler';
import { z } from 'zod';

const SearchQuerySchema = z.object({
  query: z.string().min(3).max(500),
});

export async function searchRoutes(app: FastifyInstance) {
  app.post(
    '/search',
    {
      onRequest: [app.authenticate],
      schema: {
        body: SearchQuerySchema,
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  recommendations: { type: 'array' },
                  reasoning: { type: 'string' },
                  toolCalls: { type: 'array' },
                },
              },
            },
          },
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const { query } = req.body;
        const userId = req.user.id;

        const startTime = Date.now();

        // Usar handler
        const searchHandler = new SearchHandler(app.toolsRegistry);
        const result = await searchHandler.handle(query, userId);

        const duration = Date.now() - startTime;

        console.log(`✨ Search completed in ${duration}ms`);

        return reply.code(200).send({
          success: true,
          data: result,
          metadata: {
            durationMs: duration,
            toolCallsCount: result.toolCalls.length,
          },
        });
      } catch (error) {
        app.log.error(error);

        return reply.code(500).send({
          success: false,
          error:
            error instanceof Error ? error.message : 'Internal server error',
        });
      }
    }
  );
}
```

---

## TESTING TOOLS

### Unit Test: Tool Execution

```typescript
// tests/unit/ai/search-events-tool.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SearchEventsTool } from '@/ai/tools/search-events';
import { EventService } from '@/domain/events/event.service';

describe('SearchEventsTool', () => {
  let tool: SearchEventsTool;
  let eventService: EventService;

  beforeEach(() => {
    eventService = new EventService(new EventRepository());
    tool = new SearchEventsTool(eventService);

    // Mock
    vi.spyOn(eventService, 'search').mockResolvedValue([
      { id: '1', title: 'Concert', genre: 'music' },
      { id: '2', title: 'Play', genre: 'theater' },
    ]);
  });

  it('should return tool definition', () => {
    const def = tool.getDefinition();
    expect(def.name).toBe('search_events');
    expect(def.input_schema).toBeDefined();
  });

  it('should execute with valid input', async () => {
    const result = await tool.execute({
      genres: ['music'],
      max_price: 100,
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
  });

  it('should reject invalid input', async () => {
    const result = await tool.execute({
      min_price: -10, // Inválido
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
```

### Integration Test: Multi-Turn

```typescript
// tests/integration/search-multi-turn.test.ts

describe('Search Handler Multi-Turn', () => {
  it('should handle multi-turn reasoning', async () => {
    const handler = new SearchHandler(toolsRegistry);

    const result = await handler.handle(
      'Find me romantic events this weekend under €50',
      'user_123'
    );

    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.toolCalls.length).toBeGreaterThan(0);

    // Verificar que se llamaron múltiples tools
    const toolNames = result.toolCalls.map((tc) => tc.toolName);
    expect(toolNames).toContain('search_events');
  });

  it('should handle tool errors gracefully', async () => {
    vi.spyOn(eventService, 'search').mockRejectedValueOnce(
      new Error('DB error')
    );

    const handler = new SearchHandler(toolsRegistry);
    const result = await handler.handle('Find events', 'user_123');

    // No debe fallar la llamada, pero recommendations vacío
    expect(result.toolCalls[0].result.success).toBe(false);
  });
});
```

---

## FLUJO COMPLETO: Ejemplo Real

**Usuario:** "Busca conciertos de jazz para el próximo fin de semana, románticos, menores de €40"

```
1. POST /search
   body: { query: "conciertos de jazz para el próximo fin de semana, románticos, menores de €40" }

2. SearchHandler.handle(query)

3. Mensaje 1: User → Claude
   {
     role: 'user',
     content: "conciertos de jazz para el próximo fin de semana, románticos, menores de €40"
   }

4. Claude responde con tool_use:
   {
     type: 'tool_use',
     name: 'search_events',
     id: 'tooluse_123',
     input: {
       genres: ['music', 'jazz'],
       max_price: 40,
       from_date: '2024-09-07',  // próximo viernes
       to_date: '2024-09-09'      // domingo
     }
   }

5. Backend ejecuta:
   SearchEventsTool.execute(input)
   → EventService.search({ genres: ['music', 'jazz'], priceRange: [0, 40], ... })
   → EventRepository.findByFilters()
   → PostgreSQL query
   → Retorna 5 eventos de jazz baratos

6. Mensaje 2: User → Claude (con tool result)
   {
     role: 'user',
     content: [{
       type: 'tool_result',
       tool_use_id: 'tooluse_123',
       content: '{"success": true, "data": [...]}'
     }]
   }

7. Claude llama siguiente tool:
   {
     type: 'tool_use',
     name: 'get_event_details',
     input: { event_id: 'event_1' }
   }

8. Backend ejecuta:
   GetDetailsTool.execute({ event_id: 'event_1' })
   → Retorna info completa, disponibilidad, reseñas

9. Claude piensa y retorna:
   "Te recomiendo estos conciertos de jazz para el fin de semana:
   
   1. 'Summer Jazz Festival' - Viernes 22:00
      Banda: The Blue Notes Quartet
      Precio: €35
      Rating: 4.8/5
      ¿Por qué? Es el evento más valorado y está dentro de presupuesto
   
   2. 'Intimate Jazz Night' - Sábado 21:00
      Banda: Sarah's Jazz Collective
      Precio: €38
      Rating: 4.6/5
      ¿Por qué? Ambiente muy romántico, perfecto para pareja"

10. Response al cliente:
    {
      success: true,
      data: {
        recommendations: [...],
        reasoning: "te recomiendo...",
        toolCalls: [
          { toolName: 'search_events', ... },
          { toolName: 'get_event_details', ... }
        ]
      }
    }
```

---

## CHECKLIST

- [ ] Definir `SearchEventsInputSchema` con Zod
- [ ] Implementar `SearchEventsTool.execute()`
- [ ] Implementar `GetDetailsTool` y `CheckAvailabilityTool`
- [ ] Crear `ToolsRegistry`
- [ ] Implementar `SearchHandler` con multi-turn loop
- [ ] Registrar tools en API route
- [ ] Tests de execution individual
- [ ] Tests de multi-turn
- [ ] Tests de error handling
- [ ] Logging de tool calls

---

## TL;DR

**Tools = Frontend automatizado para Claude**

1. **Define schema** (qué puede recibir/retornar)
2. **Implementa executor** (qué hace cuando se llama)
3. **Registra en registry** (disponible para Claude)
4. **Claude llama automáticamente** cuando necesita
5. **Maneja resultados** y continúa si necesario

**Esto es lo que hace diferente a un chatbot normal vs un AI Agent profesional.**
