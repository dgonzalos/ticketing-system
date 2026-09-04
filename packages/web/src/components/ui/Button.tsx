import { forwardRef, type ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', fullWidth = false, type = 'button', className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(styles.button, styles[variant], styles[size], fullWidth && styles.fullWidth, className)}
      {...props}
    />
  );
});
