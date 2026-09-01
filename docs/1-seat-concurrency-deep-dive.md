# 1. SEAT CONCURRENCY — Deep Dive

## THE PROBLEM

Imagine:
- Seat A12 available
- User A opens the page
- User B opens the page
- A selects A12 and checks out
- B also selects A12 and checks out
- **Who wins?**

```
User A            User B            Database
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

**This is a RACE CONDITION.**

---

## SOLUTIONS

### ❌ Solution 1: Trust the Frontend

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

// ❌ BAD: User A selects, User B can see it and click it too
```

**Problem:** The frontend controls nothing. The backend is the source of truth.

---

### ✅ Solution 2: Seat Locks with Timestamps (CHOSEN)

**Idea:** When a user selects a seat, reserve it for 5 minutes.

```
User A                       User B                      Database
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
   │ (User waits)               │                            │
   ├─ Pay & Checkout ──────────────────────────────────────>│
   │                            │              DELETE lock
   │                            │              UPDATE A12 = sold
   │                            │                 ✓ Success
   │                            │
   │                            │ (Retry after 5 sec)        │
   │                            ├─ Select C15 ─────────────>│
   │                            │              LOCK: C15 OK
   │                            │                 ✓ Success
```

---

## IMPLEMENTATION

### Step 1: DB Schema

```typescript
// packages/api/src/infrastructure/db/schema.ts

import { pgTable, text, timestamp, decimal } from 'drizzle-orm/pg-core';

export const seatsTable = pgTable('seats', {
  id: text('id').primaryKey(),
  performanceId: text('performance_id').notNull(),
  row: text('row').notNull(),
  number: integer('number').notNull(),
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),

  // CRITICAL: Concurrency fields
  status: text('status').default('available').notNull(),
  // 'available' | 'reserved' | 'sold' | 'blocked'

  reservedUntil: timestamp('reserved_until'),
  // Date/time when the temporary reservation expires

  reservedBy: text('reserved_by'),
  // User who holds the temporary reservation

  createdAt: timestamp('created_at').defaultNow(),
});

// Index for fast lookup of expired seats
export const seatsReservedUntilIdx = index('seats_reserved_until_idx')
  .on(seatsTable.reservedUntil);
```

---

### Step 2: SeatLock Service

```typescript
// packages/api/src/domain/seats/seat-lock.ts

import { db } from '@/infrastructure/db/connection';
import { seatsTable } from '@/infrastructure/db/schema';
import { eq, and, isNull, lt, or } from 'drizzle-orm';

/**
 * Handles temporary seat locks
 * Ensures two users can't reserve the same seat simultaneously
 */
export class SeatLockManager {
  private lockDurationMs = 5 * 60 * 1000; // 5 minutes

  /**
   * Try to lock a seat
   * Returns true if the lock succeeded, false if the seat is already taken
   */
  async lockSeat(seatId: string, userId: string): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.lockDurationMs);

    try {
      // Transaction: check state + update atomically
      const result = await db.transaction(async (tx) => {
        // 1. Get the seat's current state
        const seat = await tx
          .select()
          .from(seatsTable)
          .where(eq(seatsTable.id, seatId))
          .for('update'); // SELECT FOR UPDATE = pessimistic lock

        if (!seat[0]) {
          throw new Error(`Seat ${seatId} not found`);
        }

        const currentStatus = seat[0].status;
        const currentReservedUntil = seat[0].reservedUntil;

        // 2. Check whether it's available
        // Available if:
        // - Status is 'available', OR
        // - Status is 'reserved' but the reservation already expired
        const isAvailable =
          currentStatus === 'available' ||
          (currentStatus === 'reserved' &&
            currentReservedUntil &&
            currentReservedUntil < now);

        if (!isAvailable) {
          return false; // Seat not available
        }

        // 3. Update to 'reserved'
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
   * Release a lock without buying
   * (User abandoned checkout)
   */
  async unlockSeat(seatId: string, userId: string): Promise<void> {
    // Only the user who locked it can release it
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
   * Convert a reservation into a sale
   * (User paid successfully)
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
   * Clean up expired locks (background job)
   * Run every minute
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
   * Availability check (no lock)
   * Read-only
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

### Step 3: SeatService (High level)

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
   * User selects a seat
   * Attempts to lock it for 5 minutes
   */
  async selectSeat(
    seatId: string,
    userId: string
  ): Promise<{ success: boolean; error?: string }> {
    // Validate that the seat exists
    const seat = await this.repo.findById(seatId);
    if (!seat) {
      return { success: false, error: 'Seat not found' };
    }

    // Try to lock
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
   * User cancels the selection
   */
  async deselectSeat(seatId: string, userId: string): Promise<void> {
    await this.lockManager.unlockSeat(seatId, userId);
  }

  /**
   * Checkout confirmed
   * Convert lock into a sale
   */
  async confirmPurchase(seatIds: string[], userId: string): Promise<void> {
    // Confirm each seat within a transaction
    for (const seatId of seatIds) {
      await this.lockManager.confirmSeat(seatId, userId);
    }
  }

  /**
   * Get the map of available seats
   */
  async getPerformanceSeats(performanceId: string) {
    const seats = await this.repo.findByPerformance(performanceId);

    const now = new Date();
    return seats.map((seat) => ({
      ...seat,
      // Show as "available" if the reservation expired
      status:
        seat.status === 'reserved' && seat.reservedUntil < now
          ? 'available'
          : seat.status,
    }));
  }
}
```

---

### Step 4: API Routes

```typescript
// packages/api/src/api/routes/seats.ts

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function seatRoutes(app: FastifyInstance) {
  /**
   * GET /performances/:performanceId/seats
   * Get the seat map (for rendering)
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
   * User selects a seat
   */
  app.post<{ Params: { seatId: string } }>(
    '/seats/:seatId/select',
    {
      onRequest: [app.authenticate], // Requires JWT
    },
    async (req, reply) => {
      const { seatId } = req.params;
      const userId = req.user.id;

      const result = await seatService.selectSeat(seatId, userId);

      if (!result.success) {
        return reply.code(409).send({
          success: false,
          error: result.error,
          // 409 CONFLICT = the resource changed
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
   * User deselects a seat
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
   * Check availability of several seats (no lock)
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

## TESTING (The hard part)

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
    // Create seat in DB
  });

  it('should prevent double booking (race condition)', async () => {
    // Simulate two users trying to buy the same seat
    // simultaneously

    const [result1, result2] = await Promise.all([
      lockManager.lockSeat(seatId, userId1),
      lockManager.lockSeat(seatId, userId2),
    ]);

    // Exactly ONE must win
    expect(
      (result1 && !result2) || (!result1 && result2)
    ).toBe(true);
  });

  it('should allow new lock after expiration', async () => {
    // User 1 locks for 5 minutes
    const locked1 = await lockManager.lockSeat(seatId, userId1);
    expect(locked1).toBe(true);

    // User 2 tries to lock - fails
    const locked2 = await lockManager.lockSeat(seatId, userId2);
    expect(locked2).toBe(false);

    // Simulate expiration (fake timer)
    vi.useFakeTimers();
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000); // 5 min + 1 sec

    // User 2 tries again - now it works
    const locked3 = await lockManager.lockSeat(seatId, userId2);
    expect(locked3).toBe(true);

    vi.useRealTimers();
  });

  it('should handle concurrent checkout attempts', async () => {
    // Simulate 10 users trying to buy the same seat
    const users = Array.from({ length: 10 }, (_, i) => `user_${i}`);

    const results = await Promise.all(
      users.map((userId) => lockManager.lockSeat(seatId, userId))
    );

    // Exactly 1 must succeed
    const successes = results.filter((r) => r === true);
    expect(successes).toHaveLength(1);
  });

  it('should fail to confirm if lock expired', async () => {
    // Lock
    await lockManager.lockSeat(seatId, userId1);

    // Wait for it to expire
    vi.useFakeTimers();
    vi.advanceTimersByTime(6 * 60 * 1000); // 6 min

    // Try to confirm - should fail
    expect(async () => {
      await lockManager.confirmSeat(seatId, userId1);
    }).rejects.toThrow('Seat lock expired');

    vi.useRealTimers();
  });
});
```

### Test 2: API Integration

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
    // User 1 selects
    await api.post('/seats/seat_A12/select', {
      headers: { authorization: `Bearer ${token1}` },
    });

    // User 2 tries to select the same seat
    const response = await api.post('/seats/seat_A12/select', {
      headers: { authorization: `Bearer ${token2}` },
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('no longer available');
  });

  it('should unlock on deselection', async () => {
    // User 1 selects
    await api.post('/seats/seat_A12/select', {
      headers: { authorization: `Bearer ${token1}` },
    });

    // User 1 deselects
    const deselect = await api.delete('/seats/seat_A12/select', {
      headers: { authorization: `Bearer ${token1}` },
    });
    expect(deselect.status).toBe(200);

    // Now User 2 can select it
    const select2 = await api.post('/seats/seat_A12/select', {
      headers: { authorization: `Bearer ${token2}` },
    });
    expect(select2.status).toBe(200);
  });
});
```

---

## BACKGROUND JOB: Clean Up Expired Locks

```typescript
// packages/api/src/infrastructure/background-jobs.ts

import { SeatLockManager } from '@/domain/seats/seat-lock';

/**
 * Run every minute to clean up expired locks
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
  }, 60 * 1000); // Every minute
}
```

---

## FULL FLOW: Successful vs. Failed Purchase

### ✅ Successful Purchase

```
1. User selects A12
   POST /seats/seat_A12/select
   ✓ Locked for 5 minutes

2. User selects B15
   POST /seats/seat_B15/select
   ✓ Locked for 5 minutes

3. User checks out
   POST /orders
   body: { seatIds: ["seat_A12", "seat_B15"] }
   
   Backend:
   - Transaction:
     ├─ confirmSeat("A12", userId)
     ├─ confirmSeat("B15", userId)
     └─ Create order
   ✓ Both marked as "sold"

4. Response:
   {
     success: true,
     order: { id: "ord_123", total: 150 },
     confirmationCode: "ABC123"
   }
```

### ❌ Failed Purchase (Lock Expired)

```
1. User selects A12
   POST /seats/seat_A12/select
   ✓ Locked for 5 minutes

2. User takes a coffee break (4 minutes)
   (Lock expires automatically)

3. Another user selects A12
   POST /seats/seat_A12/select
   ✓ Now locks it

4. Original user tries to check out
   POST /orders
   
   Backend:
   - Transaction:
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
- [ ] DB transaction with `SELECT FOR UPDATE`
- [ ] API: POST `/seats/:id/select`, DELETE `/seats/:id/select`
- [ ] Tests: race condition with `Promise.all()`
- [ ] Background job: `cleanupExpiredLocks()` every minute
- [ ] Frontend: show an expiration countdown (5 min)
- [ ] Error handling: 409 CONFLICT when seat isn't available

---

## TL;DR

**The key:** Don't trust the frontend. The backend has to:

1. **Verify the current state** before every operation
2. **Use temporary locks** with automatic expiration
3. **Atomic transactions** (ALL or NOTHING)
4. **Clean up expired locks** in a background job
5. **Return 409 CONFLICT** if a race condition occurs

**This is what separates a serious project from one that "almost works."**
