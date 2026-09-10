/**
 * Input shape for inserting one seat row. Declared locally (not imported
 * from `infrastructure/db/schema/seats.ts`) because the domain layer must
 * not import a specific database driver or ORM — see `seat.repository.ts`
 * for the same pattern.
 */
export interface NewSeatInput {
  id: string;
  performanceId: string;
  row: string;
  number: number;
  zone: string;
  /** Price in cents (e.g. `5000` = $50.00). */
  price: number;
}

const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const SEATS_PER_ROW = 10;

/** Price in cents, banded by row: A-C premium, D-G standard, H-J economy. */
function zoneAndPrice(row: string): { zone: string; price: number } {
  if (row <= 'C') return { zone: 'premium', price: 15000 };
  if (row <= 'G') return { zone: 'standard', price: 9000 };
  return { zone: 'economy', price: 5000 };
}

/**
 * Builds the fixed 10-row x 10-seat layout for one performance. Shared by
 * `infrastructure/db/seed.ts` (dev-data seeding) and
 * `EventAdminService.createPerformances` (runtime performance creation) so
 * the premium/standard/economy price bands can't drift between the two —
 * a performance created with no seats is unsellable.
 *
 * Takes no capacity argument: a caller-supplied `capacity` on a
 * `CreatePerformancesCommand` is informational only (see
 * `domain/events/catalog-commands.ts`) and never changes this fixed layout.
 */
export function generateSeatMap(performanceId: string): NewSeatInput[] {
  return ROWS.flatMap((row) => {
    const { zone, price } = zoneAndPrice(row);
    return Array.from({ length: SEATS_PER_ROW }, (_, i) => {
      const number = i + 1;
      return {
        id: `${performanceId}-${row}${number}`,
        performanceId,
        row,
        number,
        zone,
        price,
      } satisfies NewSeatInput;
    });
  });
}
