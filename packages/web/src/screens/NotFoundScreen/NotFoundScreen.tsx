import { ButtonLink, PageHeader } from '../../components/ui';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import styles from './NotFoundScreen.module.css';

/**
 * Rendered for any URL no route matches, and by `PerformancesScreen` for an
 * event id that doesn't exist (e.g. an old link after a re-seed). The HTTP
 * status is still 200: Vercel's SPA rewrite serves index.html for every
 * path, and a client-routed app can't change that after the fact.
 */
export function NotFoundScreen() {
  useDocumentTitle('Page not found');
  return (
    <div className={styles.screen}>
      <PageHeader
        title="Page not found"
        description="That page doesn't exist, or the event is no longer on sale."
      />
      <ButtonLink to="/" className={styles.action}>
        Browse events
      </ButtonLink>
    </div>
  );
}
