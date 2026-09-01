# 1. CONCURRENCIA DE BUTACAS — Deep Dive

## EL PROBLEMA

Imagina:
- Butaca A12 disponible
- Usuario A abre la página
- Usuario B abre la página
- A selecciona A12 y hace checkout
- B también selecciona A12 y hace checkout
- **¿Quién gana?**

```
Usuario A         Usuario B         Database
   │                 │                 │
   ├─ Check A12 ──────────────────────>│ A12: available
   │                 │                 │
   │                 ├─ Check A12 ─────>│ A12: available (!)
   │                 │                 │
   ├─ Buy A12 ───────────────────────>│ UPDATE A12 = sold
   │                 │                 │
   │                 ├─ Buy A12 ───────>│ UPDATE A12 = sold (OOPS!)
   │                 │                 │
   └─ ERROR: Double sold!
```

**Esto es un RACE CONDITION.**

---

## SOLUCIONES

### ❌ Solución 1: Confiar en Frontend

```javascript
// frontend/src/components/SeatMap.tsx
const [selectedSeats, setSelectedSeats] = useState([]);

const handleSeatClick = (seatId) => {
  if (selectedSeats.includes(seatId)) {
    setSelectedSeats(selectedSeats.filter(s => s !== seatId));
  } else {
    setSelectedSeats([...selectedSeats, seatId]);
  }
};

// ❌ MALA: Usuario A selecciona, Usuario B puede ver y hacer click igual
```

**Problema:** Frontend no controla nada. Backend es la verdad.

---

### ✅ Solución 2: Seat Locks con Timestamps (ELEGIDA)

**Idea:** Cuando usuario selecciona una butaca, reservarla por 5 minutos.

```
Usuario A                    Usuario B                   Database
   │                            │                            │
   ├─ Select A12 ──────────────────────────────────────────>│ 
   │                            │                 LOCK: UPDATE seats
   │                            │                 SET status = 'reserved',
   │                            │                 reserved_until = NOW + 5min,
   │                            │                 reserved_by = user_A
   │                            │                 WHERE id = A12
   │                            │                    ✓ Success
   │                            │
   │                            ├─ Select A12 ─────────────>│
   │                            │              LOCK: UPDATE seats
   │                            │              SET status = 'reserved'...
   │                            │              WHERE id = A12
   │                            │                 ✗ LOCKED!
   │                            │              Error: "Seat already reserved"
   │                            │
   │ (Usuario espera)           │                            │
   ├─ Pay & Checkout ──────────────────────────────────────>│
   │                            │              DELETE lock
   │                            │              UPDATE A12 = sold
   │                            │                 ✓ Success
   │                            │
   │                            │ (Retry después de 5 seg)   │
   │                            ├─ Select C15 ─────────────>│
   │                            │              LOCK: C15 OK
   │                            │                 ✓ Success
```

---

## IMPLEMENTACIÓN

### Paso 1: Schema de DB

```typescript
// packages/api/src/infrastructure/db/schema.ts

import { pgTable, text, timestamp, decimal } from 'drizzle-orm/pg-core';

export const seatsTable = pgTable('seats', {
  id: text('id').primaryKey(),
  performanceId: text('performance_id').notNull(),
  row: text('row').notNull(),
  number: integer('number').notNull(),
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),

  // CRÍTICO: Campos para concurrencia
  status: text('status').default('available').notNull(),
  // 'available' | 'reserved' | 'sold' | 'blocked'

  reservedUntil: timestamp('reserved_until'),
  // Fecha/hora cuando expira la reserva temporal

  reservedBy: text('reserved_by'),
  // Usuario que tiene la reserva temporal

  createdAt: timestamp('created_at').defaultNow(),
});

// Índice para búsqueda rápida de butacas expiradas
export const seatsReservedUntilIdx = index('seats_reserved_until_idx')
  .on(seatsTable.reservedUntil);
```

---

### Paso 2: SeatLock Service

```typescript
// packages/api/src/domain/seats/seat-lock.ts

import { db } from '@/infrastructure/db/connection';
import { seatsTable } from '@/infrastructure/db/schema';
import { eq, and, isNull, lt, or } from 'drizzle-orm';

/**
 * Manejo de locks temporales de butacas
 * Garantiza que dos usuarios no puedan reservar la misma butaca simultáneamente
 */
export class SeatLockManager {
  private lockDurationMs = 5 * 60 * 1000; // 5 minutos

  /**
   * Intentar lockear una butaca
   * Retorna true si logró el lock, false si ya está ocupada
   */
  async lockSeat(seatId: string, userId: string): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.lockDurationMs);

    try {
      // Transacción: verificar estado + actualizar atómicamente
      const result = await db.transaction(async (tx) => {
        // 1. Obtener estado actual de la butaca
        const seat = await tx
          .select()
          .from(seatsTable)
          .where(eq(seatsTable.id, seatId))
          .for('update'); // SELECT FOR UPDATE = lock pessimista

        if (!seat[0]) {
          throw new Error(`Seat ${seatId} not found`);
        }

        const currentStatus = seat[0].status;
        const currentReservedUntil = seat[0].reservedUntil;

        // 2. Verificar si está disponible
        // Disponible si:
        // - Status es 'available', O
        // - Status es 'reserved' pero ya expiró la reserva
        const isAvailable =
          currentStatus === 'available' ||
          (currentStatus === 'reserved' &&
            currentReservedUntil &&
            currentReservedUntil < now);

        if (!isAvailable) {
          return false; // Seat no disponible
        }

        // 3. Actualizar a 'reserved'
        await tx
          .update(seatsTable)
          .set({
            status: 'reserved',
            reservedUntil: expiresAt,
            reservedBy: userId,
          })
          .where(eq(seatsTable.id, seatId));

        return true;
      });

      return result;
    } catch (error) {
      console.error(`Lock error for seat ${seatId}:`, error);
      return false;
    }
  }

  /**
   * Liberar un lock sin comprar
   * (Usuario abandonó el checkout)
   */
  async unlockSeat(seatId: string, userId: string): Promise<void> {
    // Solo el usuario que hizo lock puede liberarlo
    await db
      .update(seatsTable)
      .set({
        status: 'available',
        reservedUntil: null,
        reservedBy: null,
      })
      .where(
        and(eq(seatsTable.id, seatId), eq(seatsTable.reservedBy, userId))
      );
  }

  /**
   * Convertir reserva a venta
   * (Usuario pagó exitosamente)
   */
  async confirmSeat(seatId: string, userId: string): Promise<void> {
    const result = await db
      .update(seatsTable)
      .set({
        status: 'sold',
        reservedUntil: null,
        reservedBy: null,
      })
      .where(
        and(eq(seatsTable.id, seatId), eq(seatsTable.reservedBy, userId))
      )
      .returning();

    if (result.length === 0) {
      throw new Error(
        `Seat lock expired or was taken by another user: ${seatId}`
      );
    }
  }

  /**
   * Limpiar locks expirados (background job)
   * Correr cada minuto
   */
  async cleanupExpiredLocks(): Promise<number> {
    const now = new Date();

    const result = await db
      .update(seatsTable)
      .set({
        status: 'available',
        reservedUntil: null,
        reservedBy: null,
      })
      .where(
        and(
          eq(seatsTable.status, 'reserved'),
          lt(seatsTable.reservedUntil, now)
        )
      );

    return result.rowCount;
  }

  /**
   * Check de disponibilidad (sin lock)
   * Solo para lectura
   */
  async checkAvailability(seatIds: string[]): Promise<
    Record<string, boolean>
  > {
    const seats = await db
      .select()
      .from(seatsTable)
      .where(seatsTable.id.inArray(seatIds));

    const now = new Date();
    const availability: Record<string, boolean> = {};

    for (const seat of seats) {
      const isAvailable =
        seat.status === 'available' ||
        (seat.status === 'reserved' &&
          seat.reservedUntil &&
          seat.reservedUntil < now);

      availability[seat.id] = isAvailable;
    }

    return availability;
  }
}
```

---

### Paso 3: SeatService (Alto nivel)

```typescript
// packages/api/src/domain/seats/seat.service.ts

import { SeatLockManager } from './seat-lock';
import { SeatRepository } from './seat.repository';

export class SeatService {
  constructor(
    private lockManager: SeatLockManager,
    private repo: SeatRepository
  ) {}

  /**
   * Usuario selecciona una butaca
   * Intenta lockearla por 5 minutos
   */
  async selectSeat(
    seatId: string,
    userId: string
  ): Promise<{ success: boolean; error?: string }> {
    // Validar que la butaca existe
    const seat = await this.repo.findById(seatId);
    if (!seat) {
      return { success: false, error: 'Seat not found' };
    }

    // Intentar lock
    const locked = await this.lockManager.lockSeat(seatId, userId);

    if (!locked) {
      return {
        success: false,
        error: 'Seat is no longer available (just sold or reserved)',
      };
    }

    return { success: true };
  }

  /**
   * Usuario cancela la selección
   */
  async deselectSeat(seatId: string, userId: string): Promise<void> {
    await this.lockManager.unlockSeat(seatId, userId);
  }

  /**
   * Checkout confirmado
   * Convertir lock a venta
   */
  async confirmPurchase(seatIds: string[], userId: string): Promise<void> {
    // Confirmar cada butaca en transacción
    for (const seatId of seatIds) {
      await this.lockManager.confirmSeat(seatId, userId);
    }
  }

  /**
   * Obtener mapa de butacas disponibles
   */
  async getPerformanceSeats(performanceId: string) {
    const seats = await this.repo.findByPerformance(performanceId);

    const now = new Date();
    return seats.map((seat) => ({
      ...seat,
      // Mostrar como "available" si la reserva expiró
      status:
        seat.status === 'reserved' && seat.reservedUntil < now
          ? 'available'
          : seat.status,
    }));
  }
}
```

---

### Paso 4: API Routes

```typescript
// packages/api/src/api/routes/seats.ts

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function seatRoutes(app: FastifyInstance) {
  /**
   * GET /performances/:performanceId/seats
   * Obtener mapa de butacas (para renderizar)
   */
  app.get('/performances/:performanceId/seats', async (req, reply) => {
    const { performanceId } = req.params;

    const seats = await seatService.getPerformanceSeats(performanceId);

    return reply.send({
      success: true,
      data: seats,
    });
  });

  /**
   * POST /seats/:seatId/select
   * Usuario selecciona una butaca
   */
  app.post<{ Params: { seatId: string } }>(
    '/seats/:seatId/select',
    {
      onRequest: [app.authenticate], // Requiere JWT
    },
    async (req, reply) => {
      const { seatId } = req.params;
      const userId = req.user.id;

      const result = await seatService.selectSeat(seatId, userId);

      if (!result.success) {
        return reply.code(409).send({
          success: false,
          error: result.error,
          // 409 CONFLICT = el recurso cambió
        });
      }

      return reply.code(200).send({
        success: true,
        message: 'Seat locked for 5 minutes',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });
    }
  );

  /**
   * DELETE /seats/:seatId/select
   * Usuario deselecciona una butaca
   */
  app.delete<{ Params: { seatId: string } }>(
    '/seats/:seatId/select',
    {
      onRequest: [app.authenticate],
    },
    async (req, reply) => {
      const { seatId } = req.params;
      const userId = req.user.id;

      await seatService.deselectSeat(seatId, userId);

      return reply.send({
        success: true,
        message: 'Seat released',
      });
    }
  );

  /**
   * POST /seats/check-availability
   * Verificar disponibilidad de varias butacas (sin lock)
   */
  app.post<{ Body: { seatIds: string[] } }>(
    '/seats/check-availability',
    async (req, reply) => {
      const { seatIds } = req.body;

      const availability = await seatService.checkAvailability(seatIds);

      return reply.send({
        success: true,
        data: availability,
      });
    }
  );
}
```

---

## TESTING (Lo difícil)

### Test 1: Race Condition

```typescript
// tests/integration/seat-concurrency.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { SeatLockManager } from '@/domain/seats/seat-lock';

describe('Seat Concurrency', () => {
  let lockManager: SeatLockManager;
  const seatId = 'seat_A12';
  const userId1 = 'user_1';
  const userId2 = 'user_2';

  beforeEach(() => {
    lockManager = new SeatLockManager();
    // Crear butaca en DB
  });

  it('should prevent double booking (race condition)', async () => {
    // Simular dos usuarios intentando comprar la misma butaca
    // simultáneamente

    const [result1, result2] = await Promise.all([
      lockManager.lockSeat(seatId, userId1),
      lockManager.lockSeat(seatId, userId2),
    ]);

    // Exactamente UNO debe ganar
    expect(
      (result1 && !result2) || (!result1 && result2)
    ).toBe(true);
  });

  it('should allow new lock after expiration', async () => {
    // Usuario 1 lockea por 5 minutos
    const locked1 = await lockManager.lockSeat(seatId, userId1);
    expect(locked1).toBe(true);

    // Usuario 2 intenta lockear - falla
    const locked2 = await lockManager.lockSeat(seatId, userId2);
    expect(locked2).toBe(false);

    // Simular expiración (fake timer)
    vi.useFakeTimers();
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000); // 5 min + 1 sec

    // Usuario 2 intenta de nuevo - ahora sí funciona
    const locked3 = await lockManager.lockSeat(seatId, userId2);
    expect(locked3).toBe(true);

    vi.useRealTimers();
  });

  it('should handle concurrent checkout attempts', async () => {
    // Simular 10 usuarios intentando comprar la misma butaca
    const users = Array.from({ length: 10 }, (_, i) => `user_${i}`);

    const results = await Promise.all(
      users.map((userId) => lockManager.lockSeat(seatId, userId))
    );

    // Exactamente 1 debe tener éxito
    const successes = results.filter((r) => r === true);
    expect(successes).toHaveLength(1);
  });

  it('should fail to confirm if lock expired', async () => {
    // Lockear
    await lockManager.lockSeat(seatId, userId1);

    // Esperar a que expire
    vi.useFakeTimers();
    vi.advanceTimersByTime(6 * 60 * 1000); // 6 min

    // Intentar confirmar - debe fallar
    expect(async () => {
      await lockManager.confirmSeat(seatId, userId1);
    }).rejects.toThrow('Seat lock expired');

    vi.useRealTimers();
  });
});
```

### Test 2: Integración API

```typescript
// tests/integration/seat-api.test.ts

describe('Seat Selection API', () => {
  it('should lock seat on selection', async () => {
    const response = await api.post('/seats/seat_A12/select', {
      headers: { authorization: `Bearer ${jwtToken}` },
    });

    expect(response.status).toBe(200);
    expect(response.body.expiresAt).toBeDefined();
  });

  it('should return 409 CONFLICT if already taken', async () => {
    // Usuario 1 selecciona
    await api.post('/seats/seat_A12/select', {
      headers: { authorization: `Bearer ${token1}` },
    });

    // Usuario 2 intenta seleccionar la misma
    const response = await api.post('/seats/seat_A12/select', {
      headers: { authorization: `Bearer ${token2}` },
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('no longer available');
  });

  it('should unlock on deselection', async () => {
    // Usuario 1 selecciona
    await api.post('/seats/seat_A12/select', {
      headers: { authorization: `Bearer ${token1}` },
    });

    // Usuario 1 deselecciona
    const deselect = await api.delete('/seats/seat_A12/select', {
      headers: { authorization: `Bearer ${token1}` },
    });
    expect(deselect.status).toBe(200);

    // Ahora Usuario 2 puede seleccionar
    const select2 = await api.post('/seats/seat_A12/select', {
      headers: { authorization: `Bearer ${token2}` },
    });
    expect(select2.status).toBe(200);
  });
});
```

---

## BACKGROUND JOB: Limpiar Locks Expirados

```typescript
// packages/api/src/infrastructure/background-jobs.ts

import { SeatLockManager } from '@/domain/seats/seat-lock';

/**
 * Correr cada minuto para limpiar locks expirados
 */
export function setupCleanupJobs(lockManager: SeatLockManager) {
  setInterval(async () => {
    try {
      const cleaned = await lockManager.cleanupExpiredLocks();
      if (cleaned > 0) {
        console.log(`Cleaned up ${cleaned} expired seat locks`);
      }
    } catch (error) {
      console.error('Error cleaning up expired locks:', error);
    }
  }, 60 * 1000); // Cada minuto
}
```

---

## FLUJO COMPLETO: Compra exitosa vs fallida

### ✅ Compra Exitosa

```
1. Usuario selecciona A12
   POST /seats/seat_A12/select
   ✓ Lockea por 5 minutos

2. Usuario selecciona B15
   POST /seats/seat_B15/select
   ✓ Lockea por 5 minutos

3. Usuario hace checkout
   POST /orders
   body: { seatIds: ["seat_A12", "seat_B15"] }
   
   Backend:
   - Transacción:
     ├─ confirmSeat("A12", userId)
     ├─ confirmSeat("B15", userId)
     └─ Crear order
   ✓ Ambas se marcan como "sold"

4. Response:
   {
     success: true,
     order: { id: "ord_123", total: 150 },
     confirmationCode: "ABC123"
   }
```

### ❌ Compra Fallida (Lock Expirado)

```
1. Usuario selecciona A12
   POST /seats/seat_A12/select
   ✓ Lockea por 5 minutos

2. Usuario toma café (4 minutos)
   (Lock expira automáticamente)

3. Otro usuario selecciona A12
   POST /seats/seat_A12/select
   ✓ Ahora lockea

4. Usuario original intenta checkout
   POST /orders
   
   Backend:
   - Transacción:
     └─ confirmSeat("A12", userId)
        ✗ FAIL: "Seat lock expired or was taken"
   
5. Response:
   {
     success: false,
     error: "Seat A12 is no longer available"
   }
```

---

## CHECKLIST

- [ ] Schema: fields `status`, `reservedUntil`, `reservedBy`
- [ ] SeatLockManager: `lockSeat()`, `unlockSeat()`, `confirmSeat()`
- [ ] Transacción DB con `SELECT FOR UPDATE`
- [ ] API: POST `/seats/:id/select`, DELETE `/seats/:id/select`
- [ ] Tests: race condition con `Promise.all()`
- [ ] Background job: `cleanupExpiredLocks()` cada minuto
- [ ] Frontend: mostrar contador de expiración (5 min)
- [ ] Error handling: 409 CONFLICT cuando seat no disponible

---

## TL;DR

**La clave:** No confíes en frontend. El backend tiene que:

1. **Verificar estado actual** antes de cada operación
2. **Usar locks temporales** con expiración automática
3. **Transacciones atómicas** (TODO o NADA)
4. **Limpiar locks expirados** en background job
5. **Retornar 409 CONFLICT** si race condition ocurre

**Esto es lo que diferencia un proyecto serio de uno que "casi funciona".**
