import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './Badge.module.css';

export type BadgeTone = 'success' | 'warning' | 'neutral';

export interface BadgeProps {
  tone: BadgeTone;
  children: ReactNode;
  className?: string;
}

/** A small status pill, e.g. an order's "Paid" or "Awaiting payment". Tones map onto the semantic success/warning/subtle tokens. */
export function Badge({ tone, children, className }: BadgeProps) {
  return <span className={clsx(styles.badge, styles[tone], className)}>{children}</span>;
}
