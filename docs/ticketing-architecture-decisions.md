# Architectural Decisions — Ticketing System

## 1. MONOREPO with pnpm Workspaces

### Decision
Use a monorepo (pnpm workspaces) instead of a multi-repo or a single monolith.

### Rationale
- **Shared types**: `packages/shared` lets frontend and backend share TypeScript interfaces
- **Unified versioning**: API and frontend changes stay in sync
- **Central dependencies**: coherent library versions
- **Simpler CI/CD**: one workflow for everything

### Alternatives considered
| Option | Advantage | Disadvantage |
|--------|---------|-----------|
| **Monorepo (chosen)** | Shared types, easy refactors | More complex to partition |
| Multi-repo | Total independence | Manual type sync, versioning |
| Monolith | Fast development | Hard to scale, coupled testing |

### Trade-offs
✅ Easy to share types
❌ Requires pnpm (but it's faster than npm/yarn)

---

## 2. Fastify instead of Express

### Decision
Backend on Fastify instead of Express or NestJS.

### Rationale
- **Performance**: 3x faster than Express (important for seat availability)
- **Built-in JSON schema validation**: works great with Zod + Anthropic types
- **Type-safe routes**: better DX with TypeScript
- **Lightweight**: no NestJS boilerplate
- **Plugin system**: for modularity (auth, cors, etc.)

### Alternatives considered
| Option | Advantage | Disadvantage |
|--------|---------|-----------|
| **Fastify (chosen)** | Performance, type-safe, validation | Smaller ecosystem than Express |
| Express | Biggest ecosystem | Slow, not very type-safe |
| NestJS | Full framework, clear patterns | Overkill for this project, slow |
| Hono | Type-safe, fast | Younger, smaller ecosystem |

### Trade-offs
✅ 3x performance vs Express
❌ Smaller community than Express

---

## 3. Drizzle ORM instead of Prisma or TypeORM

### Decision
Use Drizzle ORM as the persistence layer.

### Rationale
- **Type inference**: types are inferred from the schema (you don't write them by hand)
- **Fully typed SQL**: queries are type-safe by default
- **Simple migrations**: based on TypeScript schema, not raw SQL
- **Zero runtime overhead**: compiles to plain SQL
- **pgvector support**: native for semantic search with embeddings

```typescript
// Example: automatically inferred types
const events = db
  .select()
  .from(eventsTable)
  .where(eq(eventsTable.genre, 'jazz'))
  .execute();

// TypeScript automatically knows events is Event[]
```

### Alternatives considered
| Option | Advantage | Disadvantage |
|--------|---------|-----------|
| **Drizzle (chosen)** | Type inference, typed migrations | Younger than Prisma |
| Prisma | Broad ecosystem | Generated types, raw SQL migrations, less control |
| TypeORM | Familiar decorators | Verbose, runtime overhead |
| Raw SQL (kysely) | Maximum performance | No type safety |

### Trade-offs
✅ Types perfectly in sync with the DB
❌ Less extensive documentation than Prisma

---

## 4. PostgreSQL + pgvector for Semantic Search

### Decision
Use PostgreSQL with the pgvector extension for semantic search instead of a separate vector DB.

### Rationale
- **A single database**: less infrastructure, simpler to maintain
- **pgvector is excellent**: supports similarity search, efficient indexing
- **ACID transactions**: semantic queries + relational data, atomically
- **Cost**: no need for a separate Pinecone/Weaviate
- **Real use cases**:
  - Search: user → description embedding → similar events
  - Recommendations: "events bought by similar users"

### Alternatives considered
| Option | Advantage | Disadvantage |
|--------|---------|-----------|
| **PostgreSQL + pgvector (chosen)** | One DB, transactions, simple | Less specialized semantic search |
| Separate vector DB (Pinecone) | Specialized, scalable | Extra infrastructure, complex syncing |
| Elasticsearch | Excellent full-text search | Overkill for this case |
| Redis Vector DB | Fast in-memory | Not persistent, more suited to caching |

### Trade-offs
✅ Unified infrastructure
❌ Less specialized than Pinecone for massive-scale search

---

## 5. Claude API with Tool Use (not classic RAG)

### Decision
Use Claude with tool use for recommendations/search instead of traditional RAG.

### Rationale
**Classic RAG:**
```
Query → Embedding → Search vector DB → Pass context to LLM → Response
```

**Our approach (Tool Use):**
```
Natural-language query → Claude understands → Calls search_events tool →
Returns events → Claude ranks and explains them → Response
```

**Advantages:**
- Claude understands intent: "romantic but not expensive" → automatic filtering
- No embeddings needed for queries
- Tool use enables multi-step reasoning
- Better UX: Claude explains why it's recommending each event

**Example:**
```typescript
// User: "I want a concert to celebrate my birthday with friends"
// Claude automatically calls:
// 1. search_events({ genre: 'music', social: true })
// 2. check_availability({ eventIds: [...] })
// 3. get_event_details({ eventIds: [...] })
// Then returns recommendations with an explanation
```

### Alternatives considered
| Option | Advantage | Disadvantage |
|--------|---------|-----------|
| **Tool Use (chosen)** | Multi-step reasoning, clear UX | More API calls |
| Classic RAG | Fast vector index | Less reasoning, less clear UX |
| Fine-tuning | Highly specialized | Expensive, needs training data |

### Trade-offs
✅ Better UX and reasoning
❌ More latency (multiple tool calls)

---

## 6. MCP Server as the Admin Backend

### Decision
Build a separate MCP Server for admin features instead of traditional REST endpoints.

### Rationale

**Traditional REST approach:**
```
Admin → REST API → Backend → Analyzes → Returns JSON → Admin interprets
```

**Our approach (MCP):**
```
Admin → Claude + MCP Server → Backend tools → Claude analyzes → Natural-language response

E.g.: "Which event has the most demand? What's the best pricing strategy?"
Claude calls MCP tools → analyzes → returns clear insights
```

**Advantages:**
- Admin doesn't need a special UI
- Claude does the analysis (not just data passing)
- Natural-language questions: "Are there fraud patterns this week?"
- Extensible: add new capabilities without a UI update

### Alternatives considered
| Option | Advantage | Disadvantage |
|--------|---------|-----------|
| **MCP Server (chosen)** | Natural language, automatic analysis | Requires MCP setup |
| REST + Dashboard | Visual UI | Manual, doesn't scale |
| Webhooks + streaming | Real-time time-series | Complex to debug |

### Trade-offs
✅ Automatic, intelligent analysis
❌ Requires understanding MCP

---

## 7. Structured Outputs for Analytics

### Decision
Use Claude's Structured Outputs (JSON Schema) instead of text parsing.

### Rationale
**Without Structured Outputs (fragile):**
```
Claude generates text → Regex parsing → Hope it works
Response can be inconsistent, requires manual parsing
```

**With Structured Outputs (safe):**
```
Claude returns JSON validated against a schema → Zod validates → Type-safe
Guaranteed to match the schema
```

**Example:**
```typescript
const schema = z.object({
  demand_level: z.enum(['low', 'medium', 'high']),
  fraud_score: z.number().min(0).max(1),
  recommended_actions: z.array(z.string()),
  confidence: z.number()
});

// Claude MUST return exactly this shape
// If not, immediate error (no hallucination)
```

### Alternatives considered
| Option | Advantage | Disadvantage |
|--------|---------|-----------|
| **Structured Outputs (chosen)** | Guaranteed, type-safe | Requires a JSON schema |
| Text parsing + Regex | Simple at first | Fragile, error-prone |
| Zod coercion | Flexible | Not compatible with Claude's response_format |

### Trade-offs
✅ Format guarantee
❌ Less flexible than text (but that's a good thing for types)

---

## 8. TanStack Query instead of Context/Zustand

### Decision
Use TanStack Query for server state management, not Context or Zustand.

### Rationale
- **Real problem**: server state (events, orders) needs to stay in sync
- **TanStack Query solves**:
  - Automatic caching
  - Smart revalidation
  - Optimistic updates
  - Request cancellation
  - Stale-while-revalidate pattern

```typescript
// Example: event search
const { data: events, isLoading, error } = useQuery({
  queryKey: ['events', filters],  // Automatic caching
  queryFn: () => api.search(filters),
  staleTime: 5 * 60 * 1000,  // 5 min cached
  retry: 3,  // Automatic retries
});

// No Zustand needed for this
```

### Alternatives considered
| Option | Advantage | Disadvantage |
|--------|---------|-----------|
| **TanStack Query (chosen)** | Server-state specific, smart caching | Learning curve |
| Zustand | Simple, lightweight | Doesn't handle server sync |
| Context API | Native | Prop drilling, not specialized |
| Redux | Predictable | Overkill, boilerplate |

### Trade-offs
✅ Server state handled correctly
❌ One more dependency

---

## 9. CSS Modules instead of a UI Library or Utility Framework

### Decision
Use CSS Modules + custom components instead of Tailwind CSS, shadcn/ui, or Material-UI.

### Rationale
- **The ticketing app needs specific design**: seat maps, complex visualizations
- **shadcn/ui and Material-UI are great**: but they assume a certain design
- **Tailwind is fast, but mixes styling into JSX**: we prefer separate CSS, scoped per component
- **CSS Modules + custom components**:
  - Total control, no utility classes in the markup
  - Automatic per-file scoping (no name collisions, no need for BEM)
  - Domain-specific components (SeatMap, ZoneSelector)
  - Zero config: Vite supports `*.module.css` natively
  - Smaller bundle (no unused components, no utility framework)

```typescript
// Example: a domain-specific component
// A UI library has <Button>, but not <SeatMap>
import styles from './SeatMap.module.css';

const SeatMap = ({ performance, onSelect }) => {
  return (
    <svg className={styles.seatMap}>
      {/* Dynamic seat rendering */}
    </svg>
  );
};
```

### Alternatives considered
| Option | Advantage | Disadvantage |
|--------|---------|-----------|
| **CSS Modules + custom (chosen)** | Flexible, scoped, zero config in Vite | More upfront code |
| Tailwind CSS | Fast to prototype | Utility classes in JSX, less separation of concerns |
| shadcn/ui | Excellent DX, accessible | Assumes a certain design |
| Material-UI | Professional | Heavy, opinionated |
| Bootstrap | Well-known | Bloated |

### Trade-offs
✅ Total flexibility, styles isolated per component
❌ More design responsibility

---

## 10. Vitest + Testing Library instead of Jest

### Decision
Use Vitest for testing instead of Jest.

### Rationale
- **Vitest is faster**: built on Vite, faster execution
- **Jest-compatible**: identical syntax, better performance
- **Better for Vite projects**: Jest was designed pre-Vite

```bash
# Jest: ~5-10s per test suite
# Vitest: ~1-2s for the same suite
```

### Alternatives considered
| Option | Advantage | Disadvantage |
|--------|---------|-----------|
| **Vitest (chosen)** | Fast, Vite-native, Jest-compatible | Younger than Jest |
| Jest | Large ecosystem | Slow for Vite |
| Cypress/Playwright | Excellent E2E | Not for unit tests |

### Trade-offs
✅ Faster tests
❌ Slightly smaller ecosystem

---

## 11. Docker Compose in Development

### Decision
Docker Compose for PostgreSQL + Redis in development.

### Rationale
- **Consistency**: dev ≈ prod (same Postgres, Redis version)
- **No local install**: PostgreSQL doesn't clutter your machine
- **Reproducible**: teammates or CI/CD use the same setup
- **Easy cleanup**: `docker-compose down && docker volume prune`

```bash
# Start
docker-compose up

# Stop
docker-compose down

# Clean, isolated, reproducible
```

### Alternatives considered
| Option | Advantage | Disadvantage |
|--------|---------|-----------|
| **Docker Compose (chosen)** | Reproducible, clean, dev≈prod | Requires Docker |
| Local Postgres + Redis | No Docker overhead | Messy, inconsistent |
| Cloud Postgres (AWS RDS) | No local overhead | Requires AWS credentials, latency |

### Trade-offs
✅ Reproducibility
❌ Requires Docker Desktop

---

## 12. GitHub Actions for CI/CD (not GitLab/Circle)

### Decision
Use GitHub Actions for CI/CD.

### Rationale
- **Already on GitHub**: no platform switch
- **Free for open source projects**
- **First-class GitHub integration**: checks on PRs
- **Simple for this project**:
  - Test on every push
  - Build on every merge to main
  - Automatic deploy (if wired up)

### Alternatives considered
| Option | Advantage | Disadvantage |
|--------|---------|-----------|
| **GitHub Actions (chosen)** | Free, integrated, simple | Less mature than Circle/Jenkins |
| CircleCI | Enterprise-ready | Another vendor |
| GitLab CI | Very good | Platform switch |

### Trade-offs
✅ Perfect integration with GitHub
❌ UI isn't the best

---

## DECISION MATRIX

| Decision | Chosen option | Critical for | Would change if... |
|----------|----------------|-------------|-----------------|
| Monorepo | pnpm workspaces | Shared types | We needed a multi-repo |
| Backend | Fastify | Performance | We needed more boilerplate (NestJS) |
| ORM | Drizzle | Type safety | Prisma added pgvector support |
| DB + Search | PostgreSQL + pgvector | Operationally simple | Scaling to millions of events |
| AI Pattern | Tool Use | Intelligent reasoning | We needed < 100ms latency |
| Admin | MCP Server | Admin intelligence | A visual dashboard was required |
| Schema | Structured Outputs | Reliability | We needed maximum flexibility |
| State | TanStack Query | Server sync | State were client-only |
| UI | CSS Modules | Flexibility + scoping | We needed pre-built components |
| Testing | Vitest | Dev speed | We needed the biggest ecosystem |
| Dev DB | Docker Compose | Reproducibility | Docker wasn't usable |
| CI/CD | GitHub Actions | Simplicity | We needed very complex workflows |

---

## RISKS AND MITIGATIONS

### Risk 1: Seat concurrency
**Problem**: Two users buy the same seat
**Mitigation**:
- Temporary lock in the DB (seat.reserved_until)
- Backend is the source of truth
- Pre-checkout validation

### Risk 2: Claude API latency
**Problem**: Tool use can be slow (3-5s)
**Mitigation**:
- Caching with TanStack Query
- Fast search as a fallback
- Streaming responses

### Risk 3: MCP complexity
**Problem**: MCP is young, documentation is limited
**Mitigation**:
- Use the official Anthropic SDK
- Thorough MCP server tests
- Keep the REST API as a fallback

### Risk 4: pgvector performance
**Problem**: Semantic search is slow with many events
**Mitigation**:
- Indexing (IVFFlat, HNSW)
- Pre-vector-search filtering
- Embedding caching

---

## CONCLUSION

Every decision is made for **maximum CV impact**:
- ✅ **Professional**: production-ready patterns
- ✅ **Modern**: 2024 stack (Vite, Drizzle, pgvector, MCP)
- ✅ **A differentiator**: Claude + MCP + Structured Outputs
- ✅ **Documented**: every decision justified

This project isn't "hello world" — it's "how do I integrate AI professionally."
