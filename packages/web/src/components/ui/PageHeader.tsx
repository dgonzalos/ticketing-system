import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
}

/** A centered screen heading: optional eyebrow label, title, and optional description. */
export function PageHeader({ eyebrow, title, description }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
      <h2 className={styles.title}>{title}</h2>
      {description && <p className={styles.description}>{description}</p>}
    </header>
  );
}
