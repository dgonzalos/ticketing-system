import clsx from 'clsx';
import styles from './Skeleton.module.css';

export interface SkeletonProps {
  /** Any CSS length; defaults to the full width of the container. */
  width?: string;
  /** Any CSS length. */
  height?: string;
  radius?: 'control' | 'card';
  className?: string;
}

/**
 * A placeholder block shaped like content that's still loading. Purely
 * decorative (`aria-hidden`) — wrap skeletons in `LoadingState`, which owns
 * the `aria-busy` region and the screen-reader "Loading…" text.
 */
export function Skeleton({ width = '100%', height = '1rem', radius = 'control', className }: SkeletonProps) {
  return (
    <div
      className={clsx(styles.skeleton, radius === 'card' ? styles.card : styles.control, className)}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
