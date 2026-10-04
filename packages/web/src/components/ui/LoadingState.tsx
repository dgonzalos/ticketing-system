import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import styles from './LoadingState.module.css';

/** How long a load runs before it's probably a cold start rather than a normal fetch. */
export const SLOW_LOAD_MS = 4000;

export interface LoadingStateProps {
  /** Skeletons shaped like the content being loaded. */
  children: ReactNode;
  className?: string;
}

/**
 * Wraps a screen's loading skeletons: marks the region `aria-busy`, gives
 * screen readers a plain "Loading…", and — if the load is still running
 * after {@link SLOW_LOAD_MS} — explains why. The demo's API and database
 * scale to zero when idle (see CLAUDE.md "Cold starts are accepted,
 * deliberately"), so a slow first load is expected, and saying so turns it
 * into a designed state rather than a broken-looking one.
 */
export function LoadingState({ children, className }: LoadingStateProps) {
  const [isSlow, setIsSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsSlow(true), SLOW_LOAD_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={clsx(styles.loading, className)} aria-busy="true">
      <span className={styles.visuallyHidden}>Loading…</span>
      {children}
      {isSlow && (
        <p className={styles.slowNote} role="status">
          Waking up the demo server — this can take a few seconds on the first visit.
        </p>
      )}
    </div>
  );
}
