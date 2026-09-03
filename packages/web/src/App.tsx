import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import './App.module.css';

/**
 * Main App component.
 * 
 * Wraps the application with TanStack Query provider for data fetching.
 * Currently a simple placeholder — components will be added incrementally.
 */

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className={styles.app}>
        <header className={styles.header}>
          <h1>Ticketing System</h1>
        </header>
        <main className={styles.main}>
          <p>Welcome to the ticketing system</p>
        </main>
      </div>
    </QueryClientProvider>
  );
}

const styles = {
  app: 'app',
  header: 'header',
  main: 'main'
};