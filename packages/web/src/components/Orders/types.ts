/**
 * A seat as rendered in a checkout/order summary. `price` is always the
 * snapshotted purchase price (from `OrderItemDto`, or the seat's current
 * price before purchase) — `row`/`number`/`zone` are optional because an
 * order's own wire shape (`OrderDto.items`) doesn't carry them, only
 * `seatId` + `price`; callers with fuller seat data (e.g. `CheckoutScreen`,
 * which still holds the full `Seat` list) should pass it through.
 */
export interface OrderSeatSummary {
  seatId: string;
  row?: string;
  number?: number;
  zone?: string;
  /** Price in cents. */
  price: number;
}
