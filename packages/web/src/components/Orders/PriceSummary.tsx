import styles from './PriceSummary.module.css';

interface PriceSummaryProps {
  /** All amounts in cents. */
  subtotal: number;
  tax: number;
  total: number;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Subtotal/tax/total breakdown, shared by the checkout and order-confirmation screens. */
export function PriceSummary({ subtotal, tax, total }: PriceSummaryProps) {
  return (
    <dl className={styles.summary}>
      <div className={styles.row}>
        <dt>Subtotal</dt>
        <dd>{formatCents(subtotal)}</dd>
      </div>
      <div className={styles.row}>
        <dt>Tax (10%)</dt>
        <dd>{formatCents(tax)}</dd>
      </div>
      <div className={styles.total}>
        <dt>Total</dt>
        <dd>{formatCents(total)}</dd>
      </div>
    </dl>
  );
}
