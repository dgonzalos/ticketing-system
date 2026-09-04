import type { ElementType, ComponentPropsWithoutRef, ReactNode } from 'react';
import clsx from 'clsx';
import styles from './Card.module.css';

export interface CardProps<T extends ElementType = 'div'> {
  as?: T;
  className?: string;
  children?: ReactNode;
}

type PolymorphicCardProps<T extends ElementType> = CardProps<T> &
  Omit<ComponentPropsWithoutRef<T>, keyof CardProps<T>>;

export function Card<T extends ElementType = 'div'>({
  as,
  className,
  children,
  ...props
}: PolymorphicCardProps<T>) {
  const Component = as ?? 'div';
  return (
    <Component className={clsx(styles.card, className)} {...props}>
      {children}
    </Component>
  );
}
