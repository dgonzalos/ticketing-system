# Prompt: concurrency proof for seat locking

Add an integration test that proves `DrizzleSeatRepository.lockSeat` cannot hand the same seat to two users racing for it.

This is a **verification** phase, not a feature phase. Do not change any production code. The one exception is the falsifiability step at the end, which is a temporary local edit you revert.

---

## Why this exists

`README.md` leads with the claim that seat locking is race-safe, and `docs/1-seat-concurrency-deep-dive.md` explains the design. Neither is currently backed by a test that can fail if the guarantee breaks.

`tests/unit/domain/seats/seat-lock.test.ts` cannot fill that gap — it drives `SeatLockManager` against a mocked `ISeatRepository`, so it verifies that the manager interprets `{ locked: true | false }` correctly, never that the database actually produces exactly one `true`. The race exists only where two real Postgres transactions contend for one row, which is precisely what a mocked repository removes.

This is the same reasoning already written into `tests/integration/cancel-performance.test.ts`'s header comment. Follow that file as the pattern for everything below.

---

## Verified contract

These signatures were read from the shipped code. Do not re-derive them.

### `DrizzleSeatRepository.lockSeat` (`src/infrastructure/db/drizzle-seat.repository.ts`)

```ts
async lockSeat(seatId: string, userId: string, expiresAt: Date): Promise<SeatLockAttempt>
```

Implementation shape, which is what the test is actually about:

```ts
return this.db.transaction(async (tx) => {
  const now = new Date();
  const rows = await tx.select().from(schema.seatsTable)
    .where(eq(schema.seatsTable.id, seatId)).for('update');   // ← the guarantee

  const row = rows[0];
  if (!row) return { locked: false, seat: null };
  if (row.status === 'sold' || row.status === 'blocked' || isActiveReservation(row, now)) {
    return { locked: false, seat: toSeatLock(row) };
  }
  const [updated] = await tx.update(schema.seatsTable)
    .set({ status: 'reserved', reservedUntil: expiresAt, reservedBy: userId })
    .where(eq(schema.seatsTable.id, seatId)).returning();
  return { locked: true, seat: toSeatLock(updated) };
});
```

### Types (`src/domain/seats/seat.repository.ts`)

```ts
interface SeatLockAttempt { locked: boolean; seat: SeatLock | null }
interface SeatLock { seatId: string; status: SeatStatus; reservedBy: string | null; reservedUntil: Date | null }
type SeatStatus = 'available' | 'reserved' | 'sold' | 'blocked'
```

### `isActiveReservation` (`src/infrastructure/db/seat-queries.ts`)

```ts
export function isActiveReservation(seat: SeatRow, now: Date): boolean {
  const expired = seat.reservedUntil !== null && seat.reservedUntil < now;
  return seat.status === 'reserved' && !expired;
}
```

**Note what this does not check: ownership.** An actively-reserved seat is refused to *everybody*, including the user who already holds it. There is no "same user retrying is a no-op" path. Scenario 3 below pins this down.

### Storage

There is **no separate locks table**. The hold is three columns on the `seats` row — `status`, `reservedBy`, `reservedUntil` — with a DB-level `seats_reservation_pair_check` constraint enforcing that `reservedBy` and `reservedUntil` are always set or cleared together (`src/infrastructure/db/schema/seats.ts`). Assert against those columns, not against a lock table.

### Test harness (`tests/integration/test-db.ts`)

```ts
const testDb: TestDatabase = await createTestDatabase();  // { db, dbName, teardown }
```

Creates a uniquely-named database, migrates it, returns a Drizzle instance; `teardown()` drops it. `beforeAll`/`afterAll` both need a 30000ms timeout — see `cancel-performance.test.ts`.

Its `Pool` is constructed with pg defaults, so **max 10 connections**. See the concurrency note in scenario 1.

---

## The file

Create `packages/api/tests/integration/seat-lock-concurrency.test.ts`.

Open it with a header comment in the same voice as `cancel-performance.test.ts`: say that this test exists because the guarantee is a property of the SQL (`SELECT ... FOR UPDATE` inside a transaction), that a mocked-repository unit test structurally cannot exercise it, and that `README.md` makes this claim publicly.

Build fixtures the same way `cancel-performance.test.ts` does — insert an event, a performance, then seats directly via `testDb.db.insert(...)`. Do not call `generateSeatMap`; these tests need a handful of seats in specific states, not a 100-seat venue.

### Scenario 1 — N users race for one available seat, exactly one wins

```ts
const CONTENDERS = 10;                       // matches the pool's max connections
const userIds = Array.from({ length: CONTENDERS }, () => randomUUID());
const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

const results = await Promise.all(
  userIds.map((userId) => repository.lockSeat(seatId, userId, expiresAt))
);
```

Assert all four of these. The first is the headline; the rest are what stop a broken implementation from passing:

1. `results.filter(r => r.locked).length === 1`
2. Every losing result has `locked === false` and a non-null `seat` (the seat exists — losing is not the same as not-found)
3. Re-read the row from the database: `status === 'reserved'`, and `reservedBy` equals the userId of the single winner
4. `reservedUntil` is non-null (the pair constraint holds)

Assertion 3 is the one that matters most. Asserting only the return values would let through a bug where two callers both got `locked: true` and the second silently overwrote the first — the database would still show one holder, and a count-only test would look green.

**On `CONTENDERS = 10`:** `Promise.all` over 10 real database round-trips genuinely overlaps — they are I/O-bound and every transaction after the first blocks on the row lock. Ten matches the pool's connection ceiling, so all ten contend simultaneously. Going higher is not wrong (the surplus simply queues for a pool slot and races on arrival) but it buys nothing and makes the test slower. If you want more true simultaneity, that requires raising `max` in `test-db.ts`'s `Pool` — a change to shared harness code, so only do it if you have a reason and say so.

### Scenario 2 — race for a seat whose hold has just expired

Insert the seat as `status: 'reserved'` with `reservedBy: <someone>` and `reservedUntil` one minute in the **past**. Race `CONTENDERS` fresh users for it.

Exactly one must win, and `reservedBy` must afterwards be that winner — not the stale previous holder. This exercises the `isActiveReservation` branch under contention rather than the plain `available` path, and it is the scenario most likely to break if someone later "optimises" the expiry check.

### Scenario 3 — the same user racing themselves gets exactly one lock

Race the **same** `userId` `CONTENDERS` times for one available seat.

Exactly one attempt returns `locked: true`; the rest return `locked: false`. Document in a comment that this is current, deliberate behaviour — `isActiveReservation` ignores ownership, so an active hold is refused even to its own holder — and that a future change making a self-retry idempotent would need to update this test consciously rather than by accident.

### Scenario 4 — `sold` and `blocked` seats are never lockable under contention

Two seats, one `sold`, one `blocked`. Race `CONTENDERS` users at each.

Zero wins in both cases, and neither row's `status`, `reservedBy` or `reservedUntil` changes.

---

## Falsifiability check

A concurrency test that passes whether or not the code is correct is worse than no test, because it manufactures confidence. Prove this one has teeth:

1. In `drizzle-seat.repository.ts`, temporarily delete `.for('update')` from `lockSeat`'s select.
2. Run `pnpm --filter @ticketing/api test:integration`.
3. Scenario 1 **must fail** — without the row lock, concurrent transactions each read the seat as available under `READ COMMITTED`, and the subsequent `UPDATE ... WHERE id = ?` carries no status predicate, so the later writer overwrites the earlier one and multiple callers report `locked: true`.
4. Restore `.for('update')`. Confirm green.

If step 3 passes instead of failing, the test is not measuring what it claims to and needs rewriting before it is committed.

Report the observed failure output from step 3 — that output is the actual evidence, and it is worth quoting in the commit message.

---

## Definition of done

- `pnpm --filter @ticketing/api test:integration` passes, including the existing `cancel-performance`, `create-performances` and `usage-budget` suites.
- `pnpm --filter @ticketing/api test` still passes and still requires no database (the new file lives under `tests/integration/`, which `vitest.config.ts` excludes).
- `pnpm --filter @ticketing/api build` passes.
- The falsifiability check above was actually run, and the result is reported.
- No production source file is modified.

## Afterwards

- Add a line to `CLAUDE.md`'s "Testing strategy" section naming this file and what it guards, in the register of the surrounding prose.
- Add a cross-reference in `docs/1-seat-concurrency-deep-dive.md` pointing at the test as the executable form of the argument that document makes.
- Do not add a CI step for it. Integration tests need Postgres, and `.github/workflows/ci.yml` is deliberately database-free — see the "Continuous integration" section of `CLAUDE.md`. Changing that is a separate decision.
