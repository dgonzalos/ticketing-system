import type { ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import clsx from 'clsx';
import styles from './BackLink.module.css';

export interface BackLinkProps extends Omit<LinkProps, 'children'> {
  children: ReactNode;
}

/** A "← back" navigation link, styled consistently across screens. */
export function BackLink({ className, children, ...props }: BackLinkProps) {
  return (
    <Link className={clsx(styles.link, className)} {...props}>
      ← {children}
    </Link>
  );
}
