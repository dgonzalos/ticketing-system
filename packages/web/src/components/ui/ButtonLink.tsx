import { Link, type LinkProps } from 'react-router-dom';
import clsx from 'clsx';
import type { ButtonSize, ButtonVariant } from './Button';
import styles from './Button.module.css';

export interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

/**
 * A React Router `Link` styled as a `Button` — for navigation that should
 * look like an action (e.g. the header's "Log in"). Shares `Button.module.css`
 * so the two can't drift. Kept as its own component rather than a polymorphic
 * `as` prop on `Button`, which is a typed `forwardRef<HTMLButtonElement>` that
 * every existing caller relies on.
 */
export function ButtonLink({ variant = 'primary', size = 'md', fullWidth = false, className, ...props }: ButtonLinkProps) {
  return (
    <Link
      className={clsx(styles.button, styles[variant], styles[size], fullWidth && styles.fullWidth, className)}
      {...props}
    />
  );
}
