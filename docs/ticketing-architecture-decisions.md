# Decisiones Arquitectónicas — Ticketing System

## 1. MONOREPO con pnpm Workspaces

### Decisión
Usar monorepo (pnpm workspaces) en lugar de multirepo o monolito único.

### Justificación
- **Shared types**: `packages/shared` permite que frontend y backend compartan interfaces TypeScript
- **Versionado unificado**: Cambios en API y frontend sincronizados
- **Dependencias centrales**: Versiones coherentes de librerías
- **CI/CD más simple**: Un workflow para todo

### Alternativas consideradas
| Opción | Ventaja | Desventaja |
|--------|---------|-----------|
| **Monorepo (elegida)** | Tipos compartidos, fácil refactor | Más complejo de particionar |
| Multirepo | Independencia total | Sincronización manual de tipos, versioning |
| Monolito | Desarrollo rápido | Difícil de escalar, testing acoplado |

### Trade-offs
✅ Fácil compartir tipos
❌ Requiere pnpm (pero es más rápido que npm/yarn)

---

## 2. Fastify en lugar de Express

### Decisión
Backend con Fastify en lugar de Express o NestJS.

### Justificación
- **Performance**: 3x más rápido que Express (importante para seat availability)
- **Built-in JSON schema validation**: Funciona perfectamente con Zod + Anthropic types
- **Type-safe routes**: Mejor DX con TypeScript
- **Lightweight**: Sin boilerplate de NestJS
- **Plugins system**: Para modularity (auth, cors, etc.)

### Alternativas consideradas
| Opción | Ventaja | Desventaja |
|--------|---------|-----------|
| **Fastify (elegida)** | Performance, type-safe, validación | Menos ecosystem que Express |
| Express | Máximo ecosystem | Lento, poco type-safe |
| NestJS | Full framework, patterns claros | Overkill para este proyecto, lento |
| Hono | Type-safe, rápido | Más joven, menos ecosystem |

### Trade-offs
✅ 3x performance vs Express
❌ Community más pequeña que Express

---

## 3. Drizzle ORM en lugar de Prisma o TypeORM

### Decisión
Usar Drizzle ORM como layer de persistencia.

### Justificación
- **Type inference**: Los tipos se infieren de la schema (no necesitas escribirlos)
- **SQL totalmente tipado**: Queries son type-safe por defecto
- **Migrations simples**: Basadas en schema TypeScript, no SQL raw
- **Zero runtime overhead**: Compila a SQL puro
- **pgvector support**: Nativo para búsqueda semántica con embeddings

```typescript
// Ejemplo: tipos inferidos automáticamente
const events = db
  .select()
  .from(eventsTable)
  .where(eq(eventsTable.genre, 'jazz'))
  .execute();

// TypeScript sabe automáticamente que events es Event[]
```

### Alternativas consideradas
| Opción | Ventaja | Desventaja |
|--------|---------|-----------|
| **Drizzle (elegida)** | Type inference, migrations tipadas | Más joven que Prisma |
| Prisma | Ecosystem amplio | Generated types, migrations raw SQL, menos control |
| TypeORM | Decorators conocidos | Verboso, overhead runtime |
| Raw SQL (kysely) | Performance máxima | Sin seguridad de tipos |

### Trade-offs
✅ Tipos perfectamente sincronizados con DB
❌ Documentación menos extensa que Prisma

---

## 4. PostgreSQL + pgvector para Búsqueda Semántica

### Decisión
Usar PostgreSQL con extensión pgvector para búsqueda semántica en lugar de vector DB separada.

### Justificación
- **Una sola base de datos**: Menos infraestructura, más simple de mantener
- **pgvector es excelente**: Soporta búsqueda por similitud, indexing eficiente
- **Transacciones ACID**: Consultas semánticas + datos relacionales atómicos
- **Costo**: No necesitas Pinecone/Weaviate por separado
- **Casos de uso reales**:
  - Búsqueda: usuario → embedding de descripción → eventos similares
  - Recomendaciones: "eventos que compraron usuarios similares"

### Alternativas consideradas
| Opción | Ventaja | Desventaja |
|--------|---------|-----------|
| **PostgreSQL + pgvector (elegida)** | Una DB, transacciones, simple | Búsqueda semántica menos especializada |
| Vector DB separada (Pinecone) | Especializada, escalable | Otra infraestructura, sincronización compleja |
| Elasticsearch | Full-text search excelente | Overkill para este caso |
| Redis Vector DB | En-memory rápido | No persistent, más para caché |

### Trade-offs
✅ Infraestructura unificada
❌ Menos especializada que Pinecone para búsqueda a escala massive

---

## 5. Claude API con Tool Use (no RAG clásico)

### Decisión
Usar Claude con tool use para recomendaciones/búsqueda en lugar de RAG tradicional.

### Justificación
**RAG clásico:**
```
Query → Embedding → Buscar en vector DB → Pasar contexto a LLM → Respuesta
```

**Nuestro enfoque (Tool Use):**
```
Query en lenguaje natural → Claude entiende → Llama search_events tool →
Retorna eventos → Claude los rankea y explica → Respuesta
```

**Ventajas:**
- Claude entiende la intención: "romántico pero no caro" → filtering automático
- No necesitamos embeddings para queries
- Tool use permite multi-step reasoning
- Mejor UX: Claude explica por qué recomienda cada evento

**Ejemplo:**
```typescript
// Usuario: "Quiero un concierto para celebrar mi cumpleaños con amigos"
// Claude llama automáticamente:
// 1. search_events({ genre: 'music', social: true })
// 2. check_availability({ eventIds: [...] })
// 3. get_event_details({ eventIds: [...] })
// Luego retorna recomendaciones con explicación
```

### Alternativas consideradas
| Opción | Ventaja | Desventaja |
|--------|---------|-----------|
| **Tool Use (elegida)** | Reasoning multi-step, UX clara | Más llamadas a API |
| RAG clásico | Índice vectorial rápido | Menos reasoning, UX menos clara |
| Fine-tuning | Muy especializado | Caro, requiere datos de training |

### Trade-offs
✅ Mejor UX y reasoning
❌ Más latencia (múltiples tool calls)

---

## 6. MCP Server como Admin Backend

### Decisión
Crear MCP Server separado para funcionalidades de admin en lugar de endpoints REST tradicionales.

### Justificación

**Enfoque REST tradicional:**
```
Admin → API REST → Backend → Analiza → Retorna JSON → Admin interpreta
```

**Nuestro enfoque (MCP):**
```
Admin → Claude + MCP Server → Backend tools → Claude analiza → Respuesta en lenguaje natural

Ej: "¿Qué evento tiene más demanda? ¿Cuál es la mejor estrategia de precios?"
Claude llama tools MCP → analiza → retorna insights claros
```

**Ventajas:**
- Admin no necesita UI especial
- Claude hace el análisis (no solo data passing)
- Preguntas en lenguaje natural: "¿Hay patrones fraudulentos esta semana?"
- Extensible: agregar nuevas capacidades sin UI update

### Alternativas consideradas
| Opción | Ventaja | Desventaja |
|--------|---------|-----------|
| **MCP Server (elegida)** | Natural language, análisis automático | Requiere MCP setup |
| REST + Dashboard | UI visual | Manual, no escalable |
| Webhooks + streaming | Time-series real-time | Complejo de debuggear |

### Trade-offs
✅ Análisis inteligente automático
❌ Requiere comprensión de MCP

---

## 7. Structured Outputs para Analytics

### Decisión
Usar Structured Outputs de Claude (JSON Schema) en lugar de text parsing.

### Justificación
**Sin Structured Outputs (fragilidad):**
```
Claude genera texto → Regex parsing → Hope it works
Respuesta puede ser inconsistente, requiere parsing manual
```

**Con Structured Outputs (seguridad):**
```
Claude devuelve JSON con schema validado → Zod validates → Type-safe
Garantizado que matches el schema
```

**Ejemplo:**
```typescript
const schema = z.object({
  demand_level: z.enum(['low', 'medium', 'high']),
  fraud_score: z.number().min(0).max(1),
  recommended_actions: z.array(z.string()),
  confidence: z.number()
});

// Claude DEBE retornar este formato exacto
// Si no, error inmediato (no hallucination)
```

### Alternativas consideradas
| Opción | Ventaja | Desventaja |
|--------|---------|-----------|
| **Structured Outputs (elegida)** | Garantizado, type-safe | Requiere JSON schema |
| Text parsing + Regex | Simple inicialmente | Frágil, error-prone |
| Zod coercion | Flexible | No compatible con Claude response_format |

### Trade-offs
✅ Garantía de formato
❌ Menos flexible que text (pero eso es bueno para tipos)

---

## 8. TanStack Query en lugar de Context/Zustand

### Decisión
Usar TanStack Query para state management de servidor, no Context o Zustand.

### Justificación
- **Problema real**: Estado del servidor (eventos, órdenes) debe estar sincronizado
- **TanStack Query resuelve**:
  - Caché automático
  - Revalidación inteligente
  - Optimistic updates
  - Cancelación de requests
  - Stale-while-revalidate pattern

```typescript
// Ejemplo: Búsqueda de eventos
const { data: events, isLoading, error } = useQuery({
  queryKey: ['events', filters],  // Caché automático
  queryFn: () => api.search(filters),
  staleTime: 5 * 60 * 1000,  // 5 min cached
  retry: 3,  // Reintentos automáticos
});

// No necesitas Zustand para esto
```

### Alternativas consideradas
| Opción | Ventaja | Desventaja |
|--------|---------|-----------|
| **TanStack Query (elegida)** | Server state específico, caché inteligente | Curva aprendizaje |
| Zustand | Simple, ligero | No maneja sincronización servidor |
| Context API | Nativa | Prop drilling, no especializado |
| Redux | Predecible | Overkill, boilerplate |

### Trade-offs
✅ Estado servidor correctamente manejado
❌ Otra dependencia

---

## 9. Tailwind CSS en lugar de UI Library

### Decisión
Usar Tailwind CSS + componentes custom en lugar de shadcn/ui o Material-UI.

### Justificación
- **Ticketera necesita diseño específico**: Mapa de butacas, visualización compleja
- **shadcn/ui es great**: Pero asume cierto diseño
- **Tailwind + custom components**:
  - Total control
  - Componentes específicos del dominio (SeatMap, ZoneSelector)
  - Más pequeño en bundle (no traes componentes que no usas)

```typescript
// Ejemplo: Componente específico del dominio
// Una UI library tiene <Button>, pero no <SeatMap>
const SeatMap = ({ performance, onSelect }) => {
  return (
    <svg className="w-full h-auto">
      {/* Rendering dinámico de butacas con Tailwind */}
    </svg>
  );
};
```

### Alternativas consideradas
| Opción | Ventaja | Desventaja |
|--------|---------|-----------|
| **Tailwind + custom (elegida)** | Flexible, específico del dominio | Más código inicial |
| shadcn/ui | Excelente DX, accesible | Asume cierto diseño |
| Material-UI | Profesional | Pesado, opinionado |
| Bootstrap | Conocido | Bloated |

### Trade-offs
✅ Flexibilidad total
❌ Más responsabilidad en diseño

---

## 10. Vitest + Testing Library en lugar de Jest

### Decisión
Usar Vitest para testing en lugar de Jest.

### Justificación
- **Vitest es más rápido**: Basado en Vite, ejecución más rápida
- **Compatible con Jest**: Sintaxis idéntica, pero mejor performance
- **Mejor para Vite projects**: Jest estaba diseñado pre-Vite

```bash
# Jest: ~5-10s por test suite
# Vitest: ~1-2s misma suite
```

### Alternativas consideradas
| Opción | Ventaja | Desventaja |
|--------|---------|-----------|
| **Vitest (elegida)** | Rápido, Vite-native, Jest-compatible | Más joven que Jest |
| Jest | Ecosystem grande | Lento para Vite |
| Cypress/Playwright | E2E excellent | No para unit tests |

### Trade-offs
✅ Tests más rápidos
❌ Ecosystem ligeramente más pequeño

---

## 11. Docker Compose en desarrollo

### Decisión
Docker Compose para PostgreSQL + Redis en desarrollo.

### Justificación
- **Consistencia**: Dev ≈ Prod (mismo Postgres, Redis versión)
- **No instalar localmente**: PostgreSQL no polluta tu máquina
- **Replicable**: Compañero developer o CI/CD usa mismo setup
- **Cleanup fácil**: `docker-compose down && docker volume prune`

```bash
# Start
docker-compose up

# Stop
docker-compose down

# Limpio, aislado, reproducible
```

### Alternativas consideradas
| Opción | Ventaja | Desventaja |
|--------|---------|-----------|
| **Docker Compose (elegida)** | Reproducible, limpio, dev≈prod | Requiere Docker |
| Local Postgres + Redis | Sin Docker overhead | Sucio, inconsistente |
| Cloud Postgres (AWS RDS) | No local overhead | Requiere credenciales AWS, latencia |

### Trade-offs
✅ Reproducibilidad
❌ Requiere Docker Desktop

---

## 12. GitHub Actions para CI/CD (no GitLab/Circle)

### Decisión
Usar GitHub Actions para CI/CD.

### Justificación
- **Ya usamos GitHub**: No cambiar de plataforma
- **Gratis para proyectos open source**
- **First-class GitHub integration**: Checks en PRs
- **Simple para este proyecto**:
  - Test en cada push
  - Build en cada merge a main
  - Deploy automático (si conectamos)

### Alternativas consideradas
| Opción | Ventaja | Desventaja |
|--------|---------|-----------|
| **GitHub Actions (elegida)** | Gratis, integrado, simple | Menos maduro que Circle/Jenkins |
| CircleCI | Enterprise-ready | Otro vendor |
| GitLab CI | Muy bueno | Cambiar plataforma |

### Trade-offs
✅ Integración perfecta con GitHub
❌ UI no es la mejor

---

## MATRIZ DE DECISIONES

| Decisión | Opción elegida | Crítico para | Cambiaría si... |
|----------|----------------|-------------|-----------------|
| Monorepo | pnpm workspaces | Tipos compartidos | Necesitara multirepo |
| Backend | Fastify | Performance | Necesitara más boilerplate (NestJS) |
| ORM | Drizzle | Type safety | Prisma agregara pgvector support |
| DB + Búsqueda | PostgreSQL + pgvector | Operacional simple | Escala a millones de eventos |
| AI Pattern | Tool Use | Reasoning inteligente | Necesitara latency < 100ms |
| Admin | MCP Server | Inteligencia admin | Requiriera dashboard visual |
| Schema | Structured Outputs | Confiabilidad | Necesitara máxima flexibilidad |
| State | TanStack Query | Sync servidor | Fuera state client-only |
| UI | Tailwind | Flexibilidad | Necesitara componentes pre-built |
| Testing | Vitest | Velocidad dev | Necesitara máximo ecosystem |
| Dev DB | Docker Compose | Reproducibilidad | No pudiera usar Docker |
| CI/CD | GitHub Actions | Simplicidad | Necesitara workflows muy complejos |

---

## RIESGOS Y MITIGACIONES

### Riesgo 1: Concurrencia en butacas
**Problema**: Dos usuarios compran misma butaca
**Mitigación**:
- Lock temporal en DB (seat.reserved_until)
- Backend es fuente de verdad
- Validación pre-checkout

### Riesgo 2: Latencia de Claude API
**Problema**: Tool use puede ser lento (3-5s)
**Mitigación**:
- Caché con TanStack Query
- Búsqueda rápida como fallback
- Streaming de respuestas

### Riesgo 3: Complejidad del MCP
**Problema**: MCP es joven, documentación limitada
**Mitigación**:
- Usar SDK oficial de Anthropic
- Tests exhaustivos de MCP server
- Mantener REST API como fallback

### Riesgo 4: pgvector performance
**Problema**: Búsqueda semántica lenta con muchos eventos
**Mitigación**:
- Indexing (IVFFlat, HNSW)
- Filtering pre-vector search
- Caché de embeddings

---

## CONCLUSIÓN

Todas las decisiones están hechas para **máximo impacto en CV**:
- ✅ **Profesional**: Production-ready patterns
- ✅ **Moderno**: Stack 2024 (Vite, Drizzle, pgvector, MCP)
- ✅ **Diferenciador**: Claude + MCP + Structured Outputs
- ✅ **Documentado**: Cada decisión justificada

El proyecto no es "hello world", es "cómo integro IA profesionalmente".
